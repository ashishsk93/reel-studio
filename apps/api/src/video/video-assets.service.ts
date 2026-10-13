import { VersionPickService } from '../llm/version-pick.service';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  ASSET_STATUSES,
  SCENE_TYPES,
  hasSegment,
  ISSUE_SEVERITIES,
  VERDICTS,
  VIDEO_FIX_KINDS,
  videoAssistantChecked,
  videoReviewChecked,
  type JobStatus,
  type SegmentDto,
  type ShotBoundDto,
  type ShotBoundsUpdate,
  type VideoAssetDto,
  type VideoFixDto,
  type VideoProbeDto,
  type VideoReviewDto,
  type VideoStepDto,
} from '@reel/shared';
import { Prisma, type Asset, type Review, type Segment, type VideoJob } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { personaBlock, productBlock } from '../assets/asset-context.service';
import type { StoredAttachment } from '../assets/edit-prompt';
import { JobsService, toJobDto } from '../jobs/jobs.service';
import { LlmService, type LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { FPS, boundsIssues, mapCuts, planFrameTimes, snap, suggestWindow, toFrame } from './cuts';
import { ProbeError } from './ffmpeg';
import { MediaService } from './media.service';
import { VideoPromptError } from './video-prompt';
import { VideoService, type VideoContext } from './video.service';

export const VIDEO_PROCESS_JOB = 'video.process';
export const VIDEO_REVIEW_JOB = 'video.review';
const AssetPayload = z.object({ assetId: z.string() });

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
const MAX_VIDEO_SEC = 60;

const ShotBoundsSchema = z.array(
  z.object({
    sceneId: z.string(),
    start: z.number(),
    end: z.number(),
    inSec: z.number(),
    outSec: z.number(),
    matched: z.boolean(),
    manual: z.boolean(),
  }),
);
const FramesSchema = z.array(z.object({ t: z.number(), path: z.string() }));
/** Every scene change above a low floor, with the threshold used to call a change a cut. */
const DetectedCutsSchema = z.object({ threshold: z.number(), changes: z.array(z.object({ t: z.number(), score: z.number() })) });
type DetectedCuts = z.infer<typeof DetectedCutsSchema>;
const strongCuts = (d: DetectedCuts) => d.changes.filter((c) => c.score >= d.threshold).map((c) => c.t);
const ProbeSchema = z.object({
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  durationSec: z.number(),
  codec: z.string(),
  hasAudio: z.boolean(),
  vfr: z.boolean(),
  rotation: z.number(),
});
const StoredShotSchema = z.object({
  shot: z.number(),
  sceneId: z.string(),
  verdict: z.enum(VERDICTS),
  matchesScene: z.boolean(),
  notes: z.string(),
  issues: z.array(z.object({ severity: z.enum(ISSUE_SEVERITIES), description: z.string(), fromSec: z.number().nullable(), toSec: z.number().nullable() })),
  usableFrom: z.number().nullable(),
  usableTo: z.number().nullable(),
  bestFrom: z.number().nullable().optional(),
  suggestedIn: z.number(),
  suggestedOut: z.number(),
});
export const StoredVideoFixSchema = z.object({
  title: z.string(),
  kind: z.enum(VIDEO_FIX_KINDS),
  shot: z.number().nullable(),
  sceneId: z.string().nullable(),
  instruction: z.string(),
  motion: z.string().nullable(),
});
export type StoredVideoFix = z.infer<typeof StoredVideoFixSchema>;

const ACTIVE = new Set<JobStatus>(['queued', 'running']);

/** Step 6: uploaded videos — normalise, detect cuts, map shots, review, trim windows, segments. */
@Injectable()
export class VideoAssetsService implements OnModuleInit {
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
    private readonly video: VideoService,
    private readonly versionPick: VersionPickService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: VIDEO_PROCESS_JOB,
      group: 'media',
      payload: AssetPayload,
      run: async ({ assetId }, ctx) => {
        await this.process(assetId, (f, m) => ctx.progress(f, m), ctx.signal);
        const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
        await this.jobs.enqueue(VIDEO_REVIEW_JOB, { assetId }, { projectId: asset.projectId });
        return { assetId };
      },
    });
    this.jobs.register({
      type: VIDEO_REVIEW_JOB,
      group: 'llm',
      payload: AssetPayload,
      run: async ({ assetId }, ctx) => {
        await ctx.progress(0.1, 'Reviewing frames shot by shot');
        const reviewId = await this.review(assetId);
        return { assetId, reviewId };
      },
    });
  }

  // ---------- reads ----------

  async step(projectId: string): Promise<VideoStepDto> {
    const ctx = await this.video.context(projectId);
    const mode = ctx.project.videoMode === 'single' || ctx.project.format !== 'classic' ? 'single' : 'multi_shot';
    const jobs = await this.video.visibleJobs(projectId, mode);
    const assets = await this.prisma.asset.findMany({
      where: { videoJobId: { in: jobs.map((j) => j.id) } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { version: 'desc' },
    });
    const processing = await this.processingJobs(projectId);
    const jobDtos = jobs.map((job) =>
      this.video.toJobDto(
        ctx,
        job,
        assets.filter((a) => a.videoJobId === job.id).map((a) => this.toAssetDto(a, a.reviews[0] ?? null, processing.get(a.id), ctx)),
      ),
    );
    const segments = await this.prisma.segment.findMany({ where: { projectId }, include: { asset: true }, orderBy: { order: 'asc' } });
    const main = jobDtos.filter((j) => j.purpose === 'main');
    return {
      mode,
      jobs: jobDtos,
      totalSec: main.reduce((n, j) => n + j.durationSec, 0),
      totalCredits: Math.round(main.reduce((n, j) => n + j.creditEstimate, 0) * 100) / 100,
      scenes: ctx.scenes.map((s) => ({
        id: s.id,
        order: s.order,
        type: s.type as VideoStepDto['scenes'][number]['type'],
        onScreenText: s.onScreenText,
        targetDurationSec: s.targetDurationSec,
        imageUrl: this.storage.url(s.approvedAsset?.path),
      })),
      segments: segments.map((s) => this.toSegmentDto(s, s.asset)),
      missingSceneIds: ctx.scenes.filter((s) => !segments.some((seg) => seg.sceneId === s.id)).map((s) => s.id),
    };
  }

  private toSegmentDto(s: Segment, asset: Asset): SegmentDto {
    return {
      id: s.id,
      sceneId: s.sceneId,
      assetId: s.assetId,
      videoJobId: asset.videoJobId,
      order: s.order,
      inSec: s.inSec,
      outSec: s.outSec,
      suggestedInSec: s.suggestedInSec,
      suggestedOutSec: s.suggestedOutSec,
      onScreenText: s.onScreenText,
    };
  }

  /** Latest processing/review job per asset (payloads carry the asset id). */
  private async processingJobs(projectId: string) {
    const rows = await this.prisma.job.findMany({
      where: { projectId, type: { in: [VIDEO_PROCESS_JOB, VIDEO_REVIEW_JOB] } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const map = new Map<string, ReturnType<typeof toJobDto>>();
    for (const row of rows) {
      const { assetId } = readJson(AssetPayload, row.payload, { assetId: '' });
      if (assetId && !map.has(assetId)) map.set(assetId, toJobDto(row));
    }
    return map;
  }

  private toAssetDto(asset: Asset, review: Review | null, job: ReturnType<typeof toJobDto> | undefined, ctx: VideoContext): VideoAssetDto {
    const frames = readJson(FramesSchema, asset.frames, []);
    const show = job && (ACTIVE.has(job.status) || (job.status === 'failed' && !(review && review.createdAt.toISOString() > job.createdAt)));
    return {
      id: asset.id,
      version: asset.version,
      url: this.storage.url(asset.path)!,
      normalizedUrl: this.storage.url(asset.normalizedPath),
      status: readJson(z.enum(ASSET_STATUSES), asset.status, 'pending_review'),
      createdAt: asset.createdAt.toISOString(),
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec ?? 0,
      probe: readJson(ProbeSchema.nullable(), asset.probe, null) as VideoProbeDto | null,
      cuts: asset.detectedCuts ? strongCuts(readJson(DetectedCutsSchema, asset.detectedCuts, { threshold: 0.3, changes: [] })) : null,
      shotBounds: readJson(ShotBoundsSchema.nullable(), asset.shotBounds, null),
      frames: frames.map((f) => ({ t: f.t, url: this.storage.url(f.path)! })),
      review: review ? this.toReviewDto(review, ctx) : null,
      processing: show
        ? {
            type: job.type === VIDEO_REVIEW_JOB ? 'review' : 'process',
            status: job.status,
            message: job.message,
            progress: job.progress,
            error: job.error,
          }
        : null,
    };
  }

  private toReviewDto(review: Review, ctx: VideoContext): VideoReviewDto {
    const fixes = readJson(z.array(StoredVideoFixSchema), review.fixPrompts, []);
    return {
      id: review.id,
      verdict: readJson(z.enum(VERDICTS), review.verdict, 'warn'),
      summary: review.summary,
      shots: readJson(z.array(StoredShotSchema), review.shots, []),
      fixes: fixes.map((fix, i) => this.fixDto(fix, ctx, this.storage.apiUrl(`/reviews/${review.id}/video-fixes/${i}/attachments.zip`))),
      model: review.model,
      createdAt: review.createdAt.toISOString(),
    };
  }

  /** A stored fix as shown in the UI, with its single-scene prompt card for "regenerate this shot". */
  fixDto(fix: StoredVideoFix, ctx: VideoContext, zipUrl: string): VideoFixDto {
    const built = fix.kind === 'regenerate_shot' ? this.fixCard(fix, ctx) : null;
    return {
      title: fix.title,
      kind: fix.kind,
      shot: fix.shot,
      sceneId: fix.sceneId,
      instruction: fix.instruction,
      motion: fix.motion,
      card: built
        ? {
            prompt: built.prompt,
            attachments: built.attachments.map((a) => ({ index: a.index, label: a.label, kind: a.kind, id: a.id, url: this.storage.url(a.path), fileName: a.fileName })),
            missing: built.missing,
            notes: ['Single-scene prompt: generate this shot alone, then upload it as a replacement shot.'],
          }
        : null,
      zipUrl: built ? zipUrl : null,
    };
  }

  /**
   * One turn of the modification assistant on a video: Claude sees the shots, the current prompt,
   * the latest review and the frames, and answers with a replacement shot or a prompt rewrite.
   */
  async assistantTurn(
    assetId: string,
    request: string,
    earlier: Array<{ role: string; content: string }>,
  ): Promise<{ reply: string; fix: StoredVideoFix | null; checkAfter: string[] }> {
    const asset = await this.findVideo(assetId);
    const job = await this.video.find(asset.videoJobId!);
    const ctx = await this.video.context(job.projectId);
    const productBlocks = await this.productBlocks(ctx, this.video.expectedShots(job).map((x) => x.sceneId));
    const expected = this.video.expectedShots(job);
    const bounds = readJson(ShotBoundsSchema, asset.shotBounds, []);
    const frames = readJson(FramesSchema, asset.frames, []);
    if (!bounds.length || !frames.length) throw new Error('Wait for the video to finish processing.');
    const { shotText, compare, frameParts } = this.reviewMaterial(ctx, expected, bounds, frames);
    const review = await this.prisma.review.findFirst({ where: { assetId }, orderBy: { createdAt: 'desc' } });
    const reviewText = review
      ? [
          `Latest review: ${review.verdict}. ${review.summary}`,
          ...readJson(z.array(StoredShotSchema), review.shots, []).flatMap((s) => s.issues.map((x) => `- Shot ${s.shot} (${x.severity}): ${x.description}`)),
        ].join('\n')
      : 'Not reviewed yet.';

    const result = await this.llm.call({
      task: 'assistant',
      schema: videoAssistantChecked(bounds.length),
      system: [this.prompts.render('video-assistant'), personaBlock(ctx.project.influencer), ...productBlocks],
      content: [
        {
          type: 'text',
          text: [
            `## Video: ${this.video.jobTitle(job)}, version ${asset.version}, ${(asset.durationSec ?? 0).toFixed(2)} s, ${bounds.length} shot(s), ${job.mode === 'single' ? 'single-scene' : 'multi-shot'}`,
            ...shotText,
            '',
            'The Kling prompt that was used:',
            this.video.build(ctx, job).prompt,
            '',
            reviewText,
          ].join('\n'),
        },
        { type: 'text', text: 'References:' },
        ...compare,
        { type: 'text', text: `Frames (${frameParts.length}, in time order):` },
        ...frameParts,
        {
          type: 'text',
          text: [
            earlier.length ? 'Conversation so far:' : '',
            ...earlier.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
            '',
            `User: ${request}`,
          ]
            .filter((l, i) => l !== '' || i > 0)
            .join('\n'),
        },
      ],
      projectId: job.projectId,
      influencerId: ctx.project.influencerId,
    });
    const out = result.data;
    const shot = out.fix ? (out.fix.shot ?? (bounds.length === 1 ? 1 : null)) : null;
    const fix: StoredVideoFix | null = out.fix ? { ...out.fix, shot, sceneId: shot ? (bounds[shot - 1]?.sceneId ?? null) : null } : null;
    return { reply: out.reply.trim(), fix, checkAfter: out.checkAfter.map((c) => c.trim()).filter(Boolean) };
  }

  /** The analysis of each product shown in these scenes, as system blocks (one per product). */
  private async productBlocks(ctx: VideoContext, sceneIds: string[]): Promise<string[]> {
    const ids = [...new Set(sceneIds.map((id) => ctx.scenes.find((s) => s.id === id)?.productId).filter((x): x is string => Boolean(x)))];
    const blocks: string[] = [];
    for (const id of ids) {
      const spec = await this.product.forProduct(id);
      const title = ctx.project.products.find((p) => p.id === id)?.title;
      if (spec) blocks.push(ids.length > 1 ? `## Product: ${title}\n${productBlock(spec)}` : productBlock(spec));
    }
    return blocks;
  }

  /** Single-scene prompt for a "regenerate this shot" fix (start and end frames for a transition). */
  fixCard(fix: StoredVideoFix, ctx: VideoContext): { prompt: string; attachments: StoredAttachment[]; missing: string[] } | null {
    const scene = ctx.scenes.find((s) => s.id === fix.sceneId);
    if (!scene) return null;
    const { attachments, missing } = this.video.frames(ctx, scene);
    let prompt = '';
    try {
      prompt = this.video.singlePrompt(ctx, scene, fix.motion ?? undefined);
    } catch (error) {
      if (!(error instanceof VideoPromptError)) throw error;
      missing.push(error.message);
    }
    return { prompt, attachments, missing };
  }

  async fixZipData(reviewId: string, index: number) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId }, include: { asset: true } });
    const fix = review ? readJson(z.array(StoredVideoFixSchema), review.fixPrompts, [])[index] : undefined;
    if (!review || !fix || !review.asset.projectId) throw new NotFoundException('Fix not found');
    const built = this.fixCard(fix, await this.video.context(review.asset.projectId));
    if (!built) throw new NotFoundException('The scene of this fix no longer exists');
    return built;
  }

  // ---------- upload + processing ----------

  async upload(jobId: string, files: Express.Multer.File[]): Promise<{ assetId: string }> {
    const file = files?.[0];
    try {
      if (!file) throw new BadRequestException('Attach a video.');
      if (files.length > 1) throw new BadRequestException('Upload one video at a time.');
      const job = await this.video.find(jobId);
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) throw new BadRequestException(`Upload an ${VIDEO_EXTENSIONS.join(', ')} video.`);
      let probe: VideoProbeDto;
      try {
        probe = await this.media.probe(file.path, job.projectId);
      } catch (error) {
        throw new BadRequestException(error instanceof ProbeError ? error.message : `${file.originalname} is not a readable video.`);
      }
      if (probe.durationSec <= 0.3 || probe.durationSec > MAX_VIDEO_SEC) {
        throw new BadRequestException(`The video is ${probe.durationSec}s; expected up to ${MAX_VIDEO_SEC}s.`);
      }
      const last = await this.prisma.asset.aggregate({ where: { videoJobId: jobId }, _max: { version: true } });
      const version = (last._max.version ?? 0) + 1;
      const rel = `projects/${job.projectId}/videos/${job.id}/v${version}.${ext}`;
      await this.storage.moveInto(file.path, rel);
      const asset = await this.prisma.asset.create({
        data: {
          projectId: job.projectId,
          videoJobId: jobId,
          kind: 'video',
          version,
          path: rel,
          mime: file.mimetype || `video/${ext}`,
          width: probe.width,
          height: probe.height,
          durationSec: probe.durationSec,
          probe: toJson(probe),
          sourcePrompt: job.prompt,
        },
      });
      await this.projects.reach(job.projectId, 'videos_in_progress');
      await this.jobs.enqueue(VIDEO_PROCESS_JOB, { assetId: asset.id }, { projectId: job.projectId });
      return { assetId: asset.id };
    } finally {
      await this.storage.discardTemp(file?.path);
    }
  }

  async reprocess(assetId: string) {
    const asset = await this.findVideo(assetId);
    return this.jobs.enqueue(VIDEO_PROCESS_JOB, { assetId }, { projectId: asset.projectId });
  }

  async startReview(assetId: string) {
    const asset = await this.findVideo(assetId);
    if (!asset.normalizedPath) return this.reprocess(assetId);
    return this.jobs.enqueue(VIDEO_REVIEW_JOB, { assetId }, { projectId: asset.projectId });
  }

  private async process(assetId: string, progress: (f: number, m: string) => Promise<void>, signal: AbortSignal): Promise<void> {
    const asset = await this.findVideo(assetId);
    const job = await this.video.find(asset.videoJobId!);
    const projectId = job.projectId;
    const expected = this.video.expectedShots(job);
    const base = asset.path.replace(/\.[^.]+$/, '');
    const normalizedRel = `${base}.normalized.mp4`;

    await progress(0.05, 'Normalising (30 fps, H.264)');
    await this.media.normalize(this.storage.abs(asset.path), this.storage.abs(normalizedRel), projectId, signal);
    const probe = await this.media.probe(this.storage.abs(normalizedRel), projectId);
    const duration = probe.durationSec;

    await progress(0.5, 'Detecting cuts');
    const threshold = await this.settings.get('media.sceneThreshold');
    const changes = (await this.media.sceneChanges(this.storage.abs(normalizedRel), threshold / 4, projectId, signal)).filter(
      (c) => c.t > 0.2 && c.t < duration - 0.2,
    );
    const cuts = changes.filter((c) => c.score >= threshold).map((c) => c.t);
    const mapped =
      expected.length > 1
        ? mapCuts(expected, changes, duration, { threshold })
        : expected.map((e) => ({ sceneId: e.sceneId, start: 0, end: snap(duration), matched: true }));
    const bounds: ShotBoundDto[] = mapped.map((b, i) => ({ ...b, ...suggestWindow(b, expected[i].targetSec), manual: false }));

    await progress(0.7, 'Extracting frames');
    // Denser sampling on short clips, so the review can place the best window precisely.
    const times = planFrameTimes(duration, bounds, cuts, { fps: duration <= 8 ? 3 : 2 });
    const frameDir = `projects/${projectId}/frames/${asset.id}`;
    const files = await this.media.extractFrames(
      this.storage.abs(normalizedRel),
      times.map(toFrame),
      this.storage.abs(`${frameDir}/review`),
      projectId,
      signal,
    );
    const frames = [...new Set(times.map(toFrame))].sort((a, b) => a - b).map((n, i) => ({ t: snap(n / FPS), path: this.storage.rel(files[i]) }));

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        normalizedPath: normalizedRel,
        durationSec: duration,
        detectedCuts: toJson({ threshold, changes } satisfies DetectedCuts),
        shotBounds: toJson(bounds),
        frames: toJson(frames),
      },
    });
    await progress(0.95, 'Queued for review');
  }

  // ---------- review ----------

  /** Shot descriptions, comparison images and labelled frames: what Claude sees of a video. */
  private reviewMaterial(
    ctx: VideoContext,
    expected: ReturnType<VideoService['expectedShots']>,
    bounds: z.infer<typeof ShotBoundsSchema>,
    frames: z.infer<typeof FramesSchema>,
  ): { shotText: string[]; compare: LlmPart[]; frameParts: LlmPart[] } {
    const sceneOf = (sceneId: string) => ctx.scenes.find((s) => s.id === sceneId);

    const shotText = bounds.map((b, i) => {
      const scene = sceneOf(b.sceneId);
      const e = expected[i];
      return [
        `Shot ${i + 1}: ${b.start.toFixed(2)}–${b.end.toFixed(2)} s in the video (planned ${e?.start}–${e?.end} s${b.matched ? '' : ', no cut detected here'}).`,
        scene
          ? `  Scene ${scene.order + 1} (${scene.type}): ${scene.purpose} ${scene.outfitState === 'wearing_product' ? 'She wears the product.' : 'She is in her own clothes.'} ${scene.description} Requested motion: ${scene.motion}`
          : '  (scene deleted)',
        `  ${e?.targetSec ?? 2.5} s of this shot will be used in the Reel.`,
      ].join('\n');
    });

    const compare: LlmPart[] = [];
    if (ctx.anchor) compare.push({ type: 'image', path: ctx.anchor.path, label: `Reference: ${ctx.persona.name.split(' ')[0]}'s anchor (her face)` });
    // The front and detail photos of each product the shots show or she wears.
    const shown = [
      ...new Set(
        bounds
          .map((b) => sceneOf(b.sceneId))
          .filter((s) => s && (s.showsProduct || s.outfitState === 'wearing_product'))
          .map((s) => s!.productId)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    for (const id of shown) {
      const product = ctx.project.products.find((p) => p.id === id);
      if (!product) continue;
      const images = [...product.images].sort((a, b) => Number(b.role === 'front') - Number(a.role === 'front') || a.order - b.order);
      for (const im of images.filter((im) => im.role === 'front' || im.role === 'detail').slice(0, shown.length > 1 ? 1 : 2)) {
        compare.push({ type: 'image', path: im.path, label: `Product image (${shown.length > 1 ? `${product.title}, ` : ''}${im.role})` });
      }
    }
    bounds.forEach((b, i) => {
      const s = sceneOf(b.sceneId);
      const before = s ? ctx.beforeOf.get(s.id) : undefined;
      if (before?.approvedAsset) {
        compare.push({ type: 'image', path: before.approvedAsset.path, label: `Start frame of shot ${i + 1}: her own clothes before the outfit change` });
      }
      if (s?.approvedAsset) {
        compare.push({ type: 'image', path: s.approvedAsset.path, label: before ? `End frame of shot ${i + 1}: the outfit and look it must end on` : `Approved still for shot ${i + 1} (the look it should keep)` });
      }
    });

    const frameParts: LlmPart[] = frames.map((f) => {
      const shot = bounds.findIndex((b) => f.t >= b.start && f.t < b.end);
      return { type: 'image', path: f.path, label: `Frame t=${f.t.toFixed(2)} s · shot ${(shot < 0 ? bounds.length - 1 : shot) + 1}` };
    });
    return { shotText, compare, frameParts };
  }

  private async review(assetId: string): Promise<string> {
    const asset = await this.findVideo(assetId);
    const job = await this.video.find(asset.videoJobId!);
    const ctx = await this.video.context(job.projectId);
    const productBlocks = await this.productBlocks(ctx, this.video.expectedShots(job).map((x) => x.sceneId));
    const expected = this.video.expectedShots(job);
    const bounds = readJson(ShotBoundsSchema, asset.shotBounds, []);
    const frames = readJson(FramesSchema, asset.frames, []);
    if (!bounds.length || !frames.length) throw new Error('The video has not been processed yet.');
    const duration = asset.durationSec ?? bounds[bounds.length - 1].end;
    const { shotText, compare, frameParts } = this.reviewMaterial(ctx, expected, bounds, frames);

    const result = await this.llm.call({
      task: 'video_review',
      modelKind: 'review',
      schema: videoReviewChecked({ shotCount: bounds.length, durationSec: duration }),
      system: [this.prompts.render('video-review'), personaBlock(ctx.project.influencer), ...productBlocks],
      content: [
        {
          type: 'text',
          text: [
            `## Video: ${this.video.jobTitle(job)}, version ${asset.version}, ${duration.toFixed(2)} s, ${bounds.length} shot(s)`,
            ...shotText,
          ].join('\n'),
        },
        { type: 'text', text: 'References:' },
        ...compare,
        { type: 'text', text: `Frames (${frames.length}, in time order):` },
        ...frameParts,
        { type: 'text', text: `Review all ${bounds.length} shot(s).` },
      ],
      projectId: job.projectId,
      influencerId: ctx.project.influencerId,
    });
    const out = result.data;

    const shots = out.shots.map((s, i) => {
      const b = bounds[i];
      const window = suggestWindow(b, expected[i]?.targetSec ?? 2.5, { usableFrom: s.usableFrom, usableTo: s.usableTo, bestFrom: s.bestFrom });
      return { ...s, sceneId: b.sceneId, suggestedIn: window.inSec, suggestedOut: window.outSec };
    });
    // Reviews move the windows the user hasn't touched.
    const updatedBounds = bounds.map((b, i) => (b.manual ? b : { ...b, inSec: shots[i].suggestedIn, outSec: shots[i].suggestedOut }));
    const fixes: StoredVideoFix[] = out.fixes.map((f) => ({ ...f, sceneId: f.shot ? (bounds[f.shot - 1]?.sceneId ?? null) : null }));

    const review = await this.prisma.review.create({
      data: {
        assetId,
        verdict: out.verdict,
        summary: out.summary,
        checklist: toJson([]),
        issues: toJson(out.shots.flatMap((s) => s.issues.map((x) => ({ severity: x.severity, description: `Shot ${s.shot}: ${x.description}`, region: null })))),
        fixPrompts: toJson(fixes),
        shots: toJson(shots),
        model: result.model,
        llmCallId: result.callId,
      },
    });
    await this.prisma.asset.update({ where: { id: assetId }, data: { shotBounds: toJson(updatedBounds) } });
    if (asset.status === 'approved') await this.syncSegments(job.projectId);
    await this.versionPick.refreshVideoJob(job.id);
    return review.id;
  }

  // ---------- decisions ----------

  async approve(assetId: string): Promise<void> {
    const asset = await this.findVideo(assetId);
    if (!asset.shotBounds) throw new BadRequestException('Wait for processing to finish before approving.');
    await this.prisma.$transaction([
      this.prisma.asset.updateMany({ where: { videoJobId: asset.videoJobId, status: 'approved', id: { not: assetId } }, data: { status: 'pending_review' } }),
      this.prisma.asset.update({ where: { id: assetId }, data: { status: 'approved' } }),
    ]);
    await this.syncSegments(asset.projectId!);
  }

  async reject(assetId: string): Promise<void> {
    const asset = await this.findVideo(assetId);
    await this.prisma.asset.update({ where: { id: assetId }, data: { status: 'rejected' } });
    if (asset.status === 'approved') await this.syncSegments(asset.projectId!);
    await this.versionPick.refreshVideoJob(asset.videoJobId!);
  }

  async remove(assetId: string): Promise<void> {
    const asset = await this.findVideo(assetId);
    await this.prisma.asset.delete({ where: { id: assetId } });
    await this.storage.remove(asset.path);
    await this.storage.remove(asset.normalizedPath);
    await this.storage.removeDir(`projects/${asset.projectId}/frames/${asset.id}`);
    await this.syncSegments(asset.projectId!);
    await this.versionPick.refreshVideoJob(asset.videoJobId!);
  }

  async updateBounds(assetId: string, body: ShotBoundsUpdate): Promise<void> {
    const asset = await this.findVideo(assetId);
    const current = readJson(ShotBoundsSchema, asset.shotBounds, []);
    if (!current.length) throw new BadRequestException('The video has not been processed yet.');
    const duration = asset.durationSec ?? current[current.length - 1].end;
    const issues = boundsIssues(body.bounds, current.map((b) => b.sceneId), duration);
    if (issues.length) throw new BadRequestException({ message: 'Invalid timeline', issues: issues.map((message) => ({ path: 'bounds', message })) });
    const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
    const next = body.bounds.map((b, i) => {
      const old = current[i];
      const changed = !same(b.start, old.start) || !same(b.end, old.end) || !same(b.inSec, old.inSec) || !same(b.outSec, old.outSec);
      return {
        ...old,
        start: snap(b.start),
        end: snap(b.end),
        inSec: snap(b.inSec),
        outSec: snap(b.outSec),
        matched: old.matched && same(b.start, old.start),
        manual: old.manual || changed,
      };
    });
    await this.prisma.asset.update({ where: { id: assetId }, data: { shotBounds: toJson(next) } });
    if (asset.status === 'approved') await this.syncSegments(asset.projectId!);
  }

  /** Puts the latest review's suggestions back and clears the "edited" flags. */
  async resetBounds(assetId: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!asset?.videoJobId) throw new NotFoundException('Video not found');
    const job = await this.video.find(asset.videoJobId);
    const expected = this.video.expectedShots(job);
    const changes = readJson(DetectedCutsSchema, asset.detectedCuts, { threshold: 0.3, changes: [] }).changes;
    const threshold = await this.settings.get('media.sceneThreshold');
    const duration = asset.durationSec ?? 0;
    const shots = readJson(z.array(StoredShotSchema), asset.reviews[0]?.shots, []);
    const mapped =
      expected.length > 1
        ? mapCuts(expected, changes, duration, { threshold })
        : expected.map((e) => ({ sceneId: e.sceneId, start: 0, end: snap(duration), matched: true }));
    const bounds = mapped.map((b, i) => ({
      ...b,
      ...suggestWindow(b, expected[i].targetSec, { usableFrom: shots[i]?.usableFrom, usableTo: shots[i]?.usableTo, bestFrom: shots[i]?.bestFrom }),
      manual: false,
    }));
    await this.prisma.asset.update({ where: { id: assetId }, data: { shotBounds: toJson(bounds) } });
    if (asset.status === 'approved') await this.syncSegments(job.projectId);
  }

  /**
   * One segment per scene, from (in order of preference) an approved replacement shot or the
   * approved video of the current mode's run containing the scene. Segment text and overlay
   * settings survive while the source video stays the same.
   */
  async syncSegments(projectId: string): Promise<void> {
    const project = await this.projects.find(projectId);
    const mode = project.videoMode === 'single' || project.format !== 'classic' ? 'single' : 'multi_shot';
    // A transition's "before" still is only a start frame: it has no segment of its own.
    const scenes = (await this.prisma.scene.findMany({ where: { projectId }, orderBy: { order: 'asc' } })).filter((s) =>
      hasSegment(readJson(z.enum(SCENE_TYPES), s.type, 'custom')),
    );
    const jobs = await this.prisma.videoJob.findMany({
      where: { projectId, OR: [{ purpose: 'replacement' }, { purpose: 'main', mode }] },
      include: { assets: { where: { status: 'approved' }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { version: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const existing = await this.prisma.segment.findMany({ where: { projectId } });
    const badgeTypes: string[] = await this.settings.get('compose.badgeSceneTypes');

    for (const scene of scenes) {
      const source = this.sourceFor(scene.id, jobs);
      const current = existing.find((s) => s.sceneId === scene.id);
      if (!source) {
        if (current) await this.prisma.segment.delete({ where: { id: current.id } });
        continue;
      }
      const { asset, bound, suggestion } = source;
      // A different source video invalidates overlay detections and badge placement.
      const reset = current && current.assetId === asset.id ? {} : { detections: Prisma.DbNull, badgePlacement: Prisma.DbNull, placementWarning: null };
      const data = {
        assetId: asset.id,
        order: scene.order,
        inSec: bound.inSec,
        outSec: bound.outSec,
        suggestedInSec: suggestion?.suggestedIn ?? null,
        suggestedOutSec: suggestion?.suggestedOut ?? null,
        ...reset,
      };
      if (current) {
        await this.prisma.segment.update({ where: { id: current.id }, data });
      } else {
        const eligible = badgeTypes.includes(scene.type) && (scene.showsProduct || scene.outfitState === 'wearing_product');
        await this.prisma.segment.create({ data: { projectId, sceneId: scene.id, onScreenText: scene.onScreenText, badgeEnabled: eligible, ...data } });
      }
    }
    if (scenes.length > 0) {
      const count = await this.prisma.segment.count({ where: { projectId } });
      if (count === scenes.length) await this.projects.reach(projectId, 'videos_approved');
    }
  }

  private sourceFor(sceneId: string, jobs: Array<VideoJob & { assets: Array<Asset & { reviews: Review[] }> }>) {
    const ordered = [...jobs.filter((j) => j.purpose === 'replacement'), ...jobs.filter((j) => j.purpose === 'main')];
    for (const job of ordered) {
      const asset = job.assets[0];
      if (!asset) continue;
      const bounds = readJson(ShotBoundsSchema, asset.shotBounds, []);
      const index = bounds.findIndex((b) => b.sceneId === sceneId);
      if (index < 0) continue;
      const shots = readJson(z.array(StoredShotSchema), asset.reviews[0]?.shots, []);
      return { asset, bound: bounds[index], suggestion: shots[index] };
    }
    return null;
  }

  // ---------- frames ----------

  /** Exact frame at `t` from the normalised copy (cached per frame number). */
  async frame(assetId: string, t: number): Promise<string> {
    const asset = await this.findVideo(assetId);
    if (!asset.normalizedPath) throw new BadRequestException('The video is still processing.');
    const duration = asset.durationSec ?? 0;
    const n = Math.max(0, Math.min(toFrame(t), toFrame(duration) - 1));
    const rel = `projects/${asset.projectId}/frames/${asset.id}/preview/${n}.jpg`;
    if (!(await this.storage.exists(rel))) {
      await this.media.frameAt(this.storage.abs(asset.normalizedPath), n / FPS, this.storage.abs(rel), asset.projectId);
    }
    return this.storage.abs(rel);
  }

  /** Full-height exact frame (cover, CTA background, composited checks), cached per frame number. */
  async frameFull(assetId: string, t: number): Promise<string> {
    const asset = await this.findVideo(assetId);
    if (!asset.normalizedPath) throw new BadRequestException('The video is still processing.');
    const n = Math.max(0, Math.min(toFrame(t), toFrame(asset.durationSec ?? 0) - 1));
    const rel = `projects/${asset.projectId}/frames/${asset.id}/full/${n}.jpg`;
    if (!(await this.storage.exists(rel))) {
      await this.media.frameAt(this.storage.abs(asset.normalizedPath), n / FPS, this.storage.abs(rel), asset.projectId, 1920);
    }
    return this.storage.abs(rel);
  }

  async findVideo(assetId: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || !asset.videoJobId || asset.kind !== 'video') throw new NotFoundException('Video not found');
    return asset;
  }
}
