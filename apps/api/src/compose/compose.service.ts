import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { z } from 'zod';
import {
  BoxSchema,
  DetailRegionsChecked,
  PlacementCheckOutputSchema,
  SCENE_TYPES,
  priceLabel as formatPriceLabel,
  type Box,
  type ComposeSegmentDto,
  type ComposeStepDto,
  type CtaDto,
  type CtaUpdate,
  type DetectionsDto,
  type SegmentComposeUpdate,
  type SegmentDetections,
} from '@reel/shared';
import { Prisma, type Asset, type Composition, type Scene, type Segment } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { JobsService } from '../jobs/jobs.service';
import { DecisionService } from '../llm/decision.service';
import { LlmService } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service';
import { effectivePriceMode } from '../projects/project.mapper';
import type { Product, Source } from '../generated/prisma/client';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { FPS } from '../video/cuts';
import { MediaService } from '../video/media.service';
import { VideoAssetsService } from '../video/video-assets.service';
import { FRAME_H, FRAME_W, checkManual, placeBadge, sourceToOutput, type BadgeAnchor, type SafeZone } from '../overlay/placement';
import { renderBadge, renderCtaOverlay, renderTextOverlay } from '../overlay/render';

export const DETAILS_JOB = 'segment.details';
export const PLACEMENT_CHECK_JOB = 'segment.placement_check';
const SegmentPayload = z.object({ segmentId: z.string() });

const DetectionsSchema = z.object({
  faces: z.array(BoxSchema),
  hands: z.array(BoxSchema),
  persons: z.array(BoxSchema),
  details: z.array(BoxSchema),
  detected: z.boolean(),
  detailsChecked: z.boolean(),
});
const EMPTY_DETECTIONS: DetectionsDto = { faces: [], hands: [], persons: [], details: [], detected: false, detailsChecked: false };

const PlacementSchema = z.object({
  anchor: z.string(),
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  manual: z.boolean(),
  overlapScore: z.number(),
});

export const CtaSchema = z.object({
  text: z.string(),
  durationSec: z.number(),
  background: z.enum(['last_frame', 'chosen_frame']),
  frame: z.object({ segmentId: z.string(), timeSec: z.number() }).nullable().default(null),
  zoom: z.boolean(),
  darken: z.number(),
});
export const MusicSchema = z.object({ path: z.string(), name: z.string(), durationSec: z.number() });

export type ComposeSegment = Segment & { scene: Scene; asset: Asset };

const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const sha = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** Five evenly spaced times inside the segment's window. */
export function sampleTimes(inSec: number, outSec: number, count = 5): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((inSec + ((i + 0.5) / count) * (outSec - inSec)) * 1000) / 1000);
}

/**
 * Step 7: on-screen text overlays, the logo + price badge and its placement, the CTA, music.
 * Overlay PNGs are rendered here exactly as the final render uses them.
 */
@Injectable()
export class ComposeService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly product: ProductService,
    private readonly media: MediaService,
    private readonly videos: VideoAssetsService,
    private readonly decisions: DecisionService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: DETAILS_JOB,
      group: 'llm',
      payload: SegmentPayload,
      run: async ({ segmentId }, ctx) => {
        await ctx.progress(0.1, 'Marking garment details');
        await this.detectDetails(segmentId);
        return { segmentId };
      },
    });
    this.jobs.register({
      type: PLACEMENT_CHECK_JOB,
      group: 'llm',
      payload: SegmentPayload,
      run: async ({ segmentId }, ctx) => {
        await ctx.progress(0.1, 'Checking the badge');
        return this.checkPlacement(segmentId);
      },
    });
  }

  // ---------- reads ----------

  async segments(projectId: string): Promise<ComposeSegment[]> {
    return this.prisma.segment.findMany({ where: { projectId }, include: { scene: true, asset: true }, orderBy: { order: 'asc' } });
  }

  async composition(projectId: string): Promise<Composition> {
    const existing = await this.prisma.composition.findUnique({ where: { projectId } });
    if (existing) return existing;
    const cta = await this.settings.get('compose.cta');
    return this.prisma.composition.upsert({
      where: { projectId },
      create: { projectId, cta: toJson({ ...cta, frame: null }), cover: toJson({}) },
      update: {},
    });
  }

  async cta(projectId: string): Promise<CtaDto> {
    const defaults = await this.settings.get('compose.cta');
    const comp = await this.composition(projectId);
    return readJson(CtaSchema, comp.cta, { ...defaults, frame: null });
  }

  async zone(): Promise<SafeZone> {
    return this.settings.get('overlay.safeZone');
  }

  async eligibleTypes(): Promise<string[]> {
    return this.settings.get('compose.badgeSceneTypes');
  }

  isEligible(scene: Scene, types: string[]): boolean {
    return types.includes(scene.type) && (scene.showsProduct || scene.outfitState === 'wearing_product');
  }

  detections(segment: Segment): DetectionsDto {
    return readJson(DetectionsSchema, segment.detections, EMPTY_DETECTIONS);
  }

  async step(projectId: string, extras: Pick<ComposeStepDto, 'cover' | 'captions'>): Promise<ComposeStepDto> {
    const project = await this.projects.find(projectId);
    const segments = await this.segments(projectId);
    const zone = await this.zone();
    const types = await this.eligibleTypes();
    const cta = await this.cta(projectId);
    const products = new Map(project.products.map((p) => [p.id, p]));
    const comp = await this.composition(projectId);
    const music = readJson(MusicSchema.nullable(), comp.music, null);
    const warnings: string[] = [];

    const dtos: ComposeSegmentDto[] = [];
    for (const s of segments) {
      const text = await this.textOverlay(s, zone);
      warnings.push(...text.warnings.map((w) => `Scene ${s.scene.order + 1}: ${w}`));
      const product = s.scene.productId ? products.get(s.scene.productId) : undefined;
      const badge = product ? await this.badgeImage(product) : null;
      const mode = product ? effectivePriceMode(product) : 'hidden';
      dtos.push({
        id: s.id,
        sceneId: s.sceneId,
        sceneOrder: s.scene.order,
        sceneType: readJson(z.enum(SCENE_TYPES), s.scene.type, 'custom'),
        assetId: s.assetId,
        videoUrl: this.storage.url(s.asset.normalizedPath ?? s.asset.path)!,
        sourceWidth: s.asset.width,
        sourceHeight: s.asset.height,
        inSec: s.inSec,
        outSec: s.outSec,
        onScreenText: s.onScreenText,
        textOverlayUrl: this.storage.url(text.rel)!,
        textBox: text.box,
        badgeEligible: this.isEligible(s.scene, types),
        badgeEnabled: s.badgeEnabled,
        placement: readJson(PlacementSchema.nullable(), s.badgePlacement, null),
        placementWarning: s.placementWarning,
        detections: this.detections(s),
        sampleTimes: sampleTimes(s.inSec, s.outSec),
        product: product
          ? {
              id: product.id,
              title: product.title,
              priceLabel: formatPriceLabel(product.priceInr, mode),
              priceMode: mode,
              store: product.source.displayName,
              logoUrl: this.storage.url(product.source.logoPath),
            }
          : null,
        badge: badge ? { url: this.storage.url(badge.rel)!, w: badge.w, h: badge.h } : null,
      });
    }
    const scenes = (await this.prisma.scene.findMany({ where: { projectId }, select: { type: true } })).filter((s) => s.type !== 'transition_before').length;
    if (segments.length < scenes) warnings.unshift(`${scenes - segments.length} scene(s) have no approved video window yet.`);

    return {
      segments: dtos,
      safeZone: zone,
      cta,
      ctaPreviewUrl: this.storage.apiUrl(`/projects/${projectId}/cta/preview.jpg?v=${sha({ cta, segs: segments.map((s) => [s.assetId, s.outSec]) })}`),
      cover: extras.cover,
      captions: extras.captions,
      music: music ? { url: this.storage.url(music.path)!, name: music.name, durationSec: music.durationSec } : null,
      totalSec: Math.round((segments.reduce((n, s) => n + (s.outSec - s.inSec), 0) + cta.durationSec) * 100) / 100,
      warnings,
    };
  }

  // ---------- overlays ----------

  /**
   * Full-frame text PNG for a segment, cached by content with its box in a sidecar; keeps
   * segment.textBox in sync. The text sits around 40 % height, moving below (or above) her
   * face when detection shows they would overlap.
   */
  async textOverlay(segment: Segment, zone: SafeZone): Promise<{ rel: string; box: Box | null; warnings: string[] }> {
    const faces = this.detections(segment).faces;
    const key = sha({ t: segment.onScreenText, zone, faces, v: 3 });
    const rel = `projects/${segment.projectId}/overlays/${segment.id}/text-${key}.png`;
    const metaRel = `projects/${segment.projectId}/overlays/${segment.id}/text-${key}.json`;
    let meta: { box: Box | null; warnings: string[] };
    if (await this.storage.exists(metaRel)) {
      meta = JSON.parse(await fs.readFile(this.storage.abs(metaRel), 'utf8')) as typeof meta;
    } else {
      let out = renderTextOverlay(segment.onScreenText, zone);
      for (const centerY of [0.58, 0.66, 0.3]) {
        if (!out.box || !faces.some((f) => boxesOverlap(out.box!, f))) break;
        const next = renderTextOverlay(segment.onScreenText, zone, centerY);
        if (next.box && !faces.some((f) => boxesOverlap(next.box!, f))) out = next;
      }
      await this.storage.writeAtomic(rel, out.png);
      meta = { box: out.box, warnings: out.warnings };
      await this.storage.writeAtomic(metaRel, JSON.stringify(meta));
    }
    if (JSON.stringify(readJson(BoxSchema.nullable(), segment.textBox, null)) !== JSON.stringify(meta.box)) {
      await this.prisma.segment.update({ where: { id: segment.id }, data: { textBox: meta.box ? toJson(meta.box) : Prisma.DbNull } });
    }
    return { rel, ...meta };
  }

  /** A product's store logo + price pill at scale 1 (cached by content). */
  async badgeImage(product: Product & { source: Source }): Promise<{ rel: string; w: number; h: number } | null> {
    const label = formatPriceLabel(product.priceInr, effectivePriceMode(product));
    const logo = product.source.logoPath;
    if (!label && !logo) return null;
    const key = sha({ label, logo, v: 1 });
    const rel = `projects/${product.projectId}/overlays/badge-${key}.png`;
    const metaRel = `projects/${product.projectId}/overlays/badge-${key}.json`;
    if (await this.storage.exists(metaRel)) {
      const meta = JSON.parse(await fs.readFile(this.storage.abs(metaRel), 'utf8')) as { w: number; h: number };
      return { rel, ...meta };
    }
    const img = await renderBadge({ logoPath: logo ? this.storage.abs(logo) : null, label });
    await this.storage.writeAtomic(rel, img.png);
    await this.storage.writeAtomic(metaRel, JSON.stringify({ w: img.w, h: img.h }));
    return { rel, w: img.w, h: img.h };
  }

  /** The badge of the product a segment shows, or null (hooks and scenes without a product). */
  async badgeFor(segment: { scene: { productId: string | null } }): Promise<{ rel: string; w: number; h: number } | null> {
    if (!segment.scene.productId) return null;
    const product = await this.prisma.product.findUnique({ where: { id: segment.scene.productId }, include: { source: true } });
    return product ? this.badgeImage(product) : null;
  }

  // ---------- placement ----------

  /** Re-places every automatic badge in order (preferring the previous corner); scores manual ones. */
  async recomputePlacements(projectId: string): Promise<void> {
    const segments = await this.segments(projectId);
    const zone = await this.zone();
    let previous: BadgeAnchor | null = null;
    for (const s of segments) {
      const badge = await this.badgeFor(s);
      if (!s.badgeEnabled || !badge) {
        if (s.badgePlacement || s.placementWarning) {
          await this.prisma.segment.update({ where: { id: s.id }, data: { badgePlacement: Prisma.DbNull, placementWarning: null } });
        }
        continue;
      }
      const text = await this.textOverlay(s, zone);
      const d = this.detections(s);
      const input = { badge: { w: badge.w, h: badge.h }, detections: d, textBox: text.box, zone, previous };
      const current = readJson(PlacementSchema.nullable(), s.badgePlacement, null);
      let placement;
      let warning: string | null;
      if (current?.manual) {
        const check = checkManual(input, current.x, current.y, current.scale);
        placement = { ...current, overlapScore: check.overlapScore };
        warning = check.warning;
      } else {
        const p = placeBadge(input);
        placement = { anchor: p.anchor, x: p.x, y: p.y, scale: p.scale, manual: false, overlapScore: p.overlapScore };
        warning = p.warning;
      }
      if (!d.detected) warning = warning ?? 'Faces and hands not detected yet; the badge position is provisional.';
      previous = placement.anchor as BadgeAnchor;
      await this.prisma.segment.update({ where: { id: s.id }, data: { badgePlacement: toJson(placement), placementWarning: warning } });
    }
  }

  async updateSegment(segmentId: string, data: SegmentComposeUpdate): Promise<string> {
    const s = await this.findSegment(segmentId);
    const patch: Record<string, unknown> = {};
    if (data.onScreenText !== undefined) patch.onScreenText = data.onScreenText;
    if (data.badgeEnabled !== undefined) patch.badgeEnabled = data.badgeEnabled;
    if (data.badgePlacement === null) patch.badgePlacement = Prisma.DbNull;
    if (data.badgePlacement) {
      const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
      patch.badgePlacement = toJson({
        anchor: 'manual',
        x: Math.round(clamp(data.badgePlacement.x, FRAME_W)),
        y: Math.round(clamp(data.badgePlacement.y, FRAME_H)),
        scale: data.badgePlacement.scale,
        manual: true,
        overlapScore: 0,
      });
    }
    await this.prisma.segment.update({ where: { id: segmentId }, data: patch });
    await this.recomputePlacements(s.projectId);
    return s.projectId;
  }

  /** MediaPipe boxes from the browser (source-normalised) → output frame; then garment details and placement. */
  async saveDetections(segmentId: string, body: SegmentDetections): Promise<string> {
    const s = await this.findSegment(segmentId);
    const map = (boxes: Box[]) => boxes.map((b) => sourceToOutput(b, s.asset.width, s.asset.height)).filter((b): b is Box => b !== null);
    const current = this.detections(s);
    const next: DetectionsDto = { ...current, faces: map(body.faces), hands: map(body.hands), persons: map(body.persons), detected: true };
    await this.prisma.segment.update({ where: { id: segmentId }, data: { detections: toJson(next) } });
    const types = await this.eligibleTypes();
    if (s.badgeEnabled && this.isEligible(s.scene, types) && !current.detailsChecked) {
      await this.jobs.enqueue(DETAILS_JOB, { segmentId }, { projectId: s.projectId, idempotencyKey: `details:${segmentId}:${s.assetId}` });
    }
    await this.recomputePlacements(s.projectId);
    return s.projectId;
  }

  async startDetails(segmentId: string) {
    const s = await this.findSegment(segmentId);
    return this.jobs.enqueue(DETAILS_JOB, { segmentId }, { projectId: s.projectId });
  }

  private async detectDetails(segmentId: string): Promise<void> {
    const s = await this.findSegment(segmentId);
    const spec = s.scene.productId ? await this.product.forProduct(s.scene.productId) : null;
    const frame = await this.videos.frame(s.assetId, (s.inSec + s.outSec) / 2);
    const result = await this.llm.call({
      task: 'detail_regions',
      schema: DetailRegionsChecked,
      system: [this.prompts.render('detail-regions')],
      content: [
        {
          type: 'text',
          text: ['Must match (the details buyers check):', ...(spec?.mustMatch ?? []).map((m) => `- ${m.label}: ${m.expected}`)].join('\n'),
        },
        { type: 'image', path: frame, label: 'Frame:' },
        { type: 'text', text: 'Mark the visible key garment detail areas.' },
      ],
      projectId: s.projectId,
    });
    const details = result.data.regions.map((r) => sourceToOutput(r.box, s.asset.width, s.asset.height)).filter((b): b is Box => b !== null);
    const fresh = await this.findSegment(segmentId);
    await this.prisma.segment.update({
      where: { id: segmentId },
      data: { detections: toJson({ ...this.detections(fresh), details, detailsChecked: true }) },
    });
    await this.recomputePlacements(s.projectId);
  }

  async startPlacementCheck(segmentId: string) {
    const s = await this.findSegment(segmentId);
    if (!s.badgePlacement) throw new BadRequestException('This segment has no badge.');
    return this.jobs.enqueue(PLACEMENT_CHECK_JOB, { segmentId }, { projectId: s.projectId });
  }

  /** Composited frame (as rendered) checked by Claude; a "not ok" becomes the segment's warning. */
  private async checkPlacement(segmentId: string): Promise<{ ok: boolean; note: string }> {
    const s = await this.findSegment(segmentId);
    const jpg = await this.compositeFrame(s, (s.inSec + s.outSec) / 2);
    const rel = `projects/${s.projectId}/overlays/${s.id}/check-${randomUUID().slice(0, 8)}.jpg`;
    await this.storage.writeAtomic(rel, jpg);
    const decided = await this.decidePlacement(rel, s.projectId);
    if (decided) {
      await this.storage.remove(rel);
      if (!decided.ok) await this.prisma.segment.update({ where: { id: segmentId }, data: { placementWarning: `Check: ${decided.note}` } });
      return decided;
    }
    const result = await this.llm.call({
      task: 'placement_check',
      schema: PlacementCheckOutputSchema,
      system: [this.prompts.render('placement-check')],
      content: [{ type: 'image', path: rel, label: 'Composited frame:' }, { type: 'text', text: 'Does the badge cover the face, the hands holding the product, or key garment detail?' }],
      projectId: s.projectId,
    });
    await this.storage.remove(rel);
    if (!result.data.ok) {
      await this.prisma.segment.update({ where: { id: segmentId }, data: { placementWarning: `Claude: ${result.data.note}` } });
    }
    return result.data;
  }

  /** Badge check with the decision model: does the badge cover her face, the hands or the key detail? */
  private async decidePlacement(rel: string, projectId: string): Promise<{ ok: boolean; note: string } | null> {
    const what = { face: 'her face', hands: 'the hands holding or touching the product', detail: 'the key garment detail (embroidery, neckline, print)' };
    const answers = await this.decisions.ask({
      task: 'placement_check',
      input: [
        { type: 'text', text: 'One frame of a fashion Reel with a small white pill (store logo and price) placed on it, and maybe on-screen text.' },
        { type: 'image', path: rel },
      ],
      questions: Object.entries(what).map(([name, target]) => ({
        type: 'predicate' as const,
        name,
        instructions: `Does the white price badge cover or overlap ${target}? Touching plain background, hair at the edge or a plain part of the outfit does not count.`,
      })),
      projectId,
    });
    if (!answers) return null;
    const covered = Object.entries(what).filter(([name]) => {
      const a = answers.get(name);
      return a?.type === 'predicate' && a.probability >= 0.5;
    });
    return covered.length ? { ok: false, note: `the badge covers ${covered.map(([, t]) => t).join(' and ')}` } : { ok: true, note: 'clear' };
  }

  /** One output frame (1080×1920) with the text and badge composited exactly as rendered. */
  async compositeFrame(s: ComposeSegment, t: number): Promise<Buffer> {
    const zone = await this.zone();
    const canvas = createCanvas(FRAME_W, FRAME_H);
    const ctx = canvas.getContext('2d');
    await drawCover(ctx, await this.videos.frameFull(s.assetId, t));
    const text = await this.textOverlay(s, zone);
    ctx.drawImage(await loadImage(await fs.readFile(this.storage.abs(text.rel))), 0, 0);
    const placement = readJson(PlacementSchema.nullable(), s.badgePlacement, null);
    const badge = await this.badgeFor(s);
    if (s.badgeEnabled && placement && badge) {
      ctx.drawImage(await loadImage(await fs.readFile(this.storage.abs(badge.rel))), placement.x, placement.y, badge.w * placement.scale, badge.h * placement.scale);
    }
    return canvas.toBuffer('image/jpeg', 88);
  }

  // ---------- CTA ----------

  async updateCta(projectId: string, data: CtaUpdate): Promise<void> {
    const cta = { ...(await this.cta(projectId)), ...data };
    if (cta.background === 'chosen_frame' && !cta.frame) throw new BadRequestException('Pick a frame for the CTA background.');
    await this.prisma.composition.update({ where: { projectId }, data: { cta: toJson(cta) } });
  }

  /** The frame behind the CTA: the last frame of the last segment, or the chosen one. */
  async ctaBackground(projectId: string): Promise<{ assetId: string; t: number } | null> {
    const cta = await this.cta(projectId);
    const segments = await this.segments(projectId);
    if (cta.background === 'chosen_frame' && cta.frame) {
      const seg = segments.find((s) => s.id === cta.frame!.segmentId);
      if (seg) return { assetId: seg.assetId, t: cta.frame.timeSec };
    }
    const last = segments[segments.length - 1];
    return last ? { assetId: last.assetId, t: Math.max(last.inSec, last.outSec - 1 / FPS) } : null;
  }

  /** Still preview of the CTA end card as it will look (darkened background, text, pointer). */
  async ctaPreview(projectId: string): Promise<string> {
    const cta = await this.cta(projectId);
    const bg = await this.ctaBackground(projectId);
    const zone = await this.zone();
    const rel = `projects/${projectId}/overlays/cta-preview-${sha({ cta, bg, zone })}.jpg`;
    if (await this.storage.exists(rel)) return this.storage.abs(rel);
    const canvas = createCanvas(FRAME_W, FRAME_H);
    const ctx = canvas.getContext('2d');
    if (bg) await drawCover(ctx, await this.videos.frameFull(bg.assetId, bg.t));
    ctx.fillStyle = `rgba(0,0,0,${cta.darken})`;
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    const overlay = renderCtaOverlay(cta.text, zone);
    ctx.drawImage(await loadImage(overlay.png), 0, 0);
    ctx.drawImage(await loadImage(overlay.pointer.png), overlay.pointer.x, overlay.pointer.y);
    await this.storage.writeAtomic(rel, canvas.toBuffer('image/jpeg', 85));
    return this.storage.abs(rel);
  }

  // ---------- music ----------

  async setMusic(projectId: string, file: Express.Multer.File | undefined): Promise<void> {
    try {
      if (!file) throw new BadRequestException('Attach an audio file.');
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      if (!['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'].includes(ext)) throw new BadRequestException('Upload MP3, M4A, AAC, WAV, OGG or FLAC.');
      const probe = await this.media.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file.path], projectId);
      const data = JSON.parse(probe.stdout) as { streams?: Array<{ codec_type?: string }>; format?: { duration?: string } };
      if (!data.streams?.some((s) => s.codec_type === 'audio')) throw new BadRequestException(`${file.originalname} has no audio track.`);
      const rel = `projects/${projectId}/music/${randomUUID()}.${ext}`;
      await this.storage.moveInto(file.path, rel);
      const comp = await this.composition(projectId);
      const old = readJson(MusicSchema.nullable(), comp.music, null);
      await this.prisma.composition.update({
        where: { projectId },
        data: { music: toJson({ path: rel, name: file.originalname, durationSec: Number(data.format?.duration ?? 0) }) },
      });
      if (old) await this.storage.remove(old.path);
    } finally {
      await this.storage.discardTemp(file?.path);
    }
  }

  async removeMusic(projectId: string): Promise<void> {
    const comp = await this.composition(projectId);
    const old = readJson(MusicSchema.nullable(), comp.music, null);
    await this.prisma.composition.update({ where: { projectId }, data: { music: Prisma.DbNull } });
    if (old) await this.storage.remove(old.path);
  }

  async complete(projectId: string): Promise<void> {
    const scenes = await this.prisma.scene.count({ where: { projectId } });
    const segments = await this.prisma.segment.count({ where: { projectId } });
    if (scenes === 0 || segments < scenes) throw new BadRequestException('Approve a video window for every scene first (step 6).');
    await this.projects.reach(projectId, 'composed');
  }

  async findSegment(segmentId: string): Promise<ComposeSegment> {
    const s = await this.prisma.segment.findUnique({ where: { id: segmentId }, include: { scene: true, asset: true } });
    if (!s) throw new NotFoundException('Segment not found');
    return s;
  }
}

/** Draws an image "scale to cover, centre crop" into the 1080×1920 canvas (as the render does). */
export async function drawCover(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, file: string): Promise<void> {
  const img = await loadImage(await fs.readFile(file));
  const scale = Math.max(FRAME_W / img.width, FRAME_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h);
}
