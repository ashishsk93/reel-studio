import fs from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { z } from 'zod';
import { FORMATS, JOB_STATUSES, STORY_FORMATS, type JobDto, type QaCheckDto, type RenderDto } from '@reel/shared';
import type { Render } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { ComposeService, MusicSchema } from '../compose/compose.service';
import { CoverCaptionsService } from '../compose/cover-captions.service';
import { JobsService, toJobDto } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { renderCtaOverlay } from '../overlay/render';
import { MediaService } from '../video/media.service';
import { VideoAssetsService } from '../video/video-assets.service';
import { blackdetectArgs, parseBlackdetect, parseFinalProbe, progressSeconds, qaChecks, type BlackInterval } from './qa';
import { buildRenderArgs, joinTimes, totalDuration, type RenderPlan } from './render-args';

export const RENDER_JOB = 'render.final';
const RenderPayload = z.object({ renderId: z.string() });

const QaSchema = z.object({
  checks: z.array(z.object({ label: z.string(), ok: z.boolean(), detail: z.string() })),
  blackFrames: z.array(z.object({ start: z.number(), end: z.number(), nearJoin: z.boolean() })),
  contactSheet: z.string().nullable(),
});

const FILE_ORDER = ['final.mp4', 'cover.jpg', 'cover_titled.jpg', 'caption.txt', 'first_comment.txt', 'dm_template.txt', 'contact_sheet.jpg', 'qa.json'];

/** Step 8: the final render to Reels spec, automatic QA and the export files. */
@Injectable()
export class RenderService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly media: MediaService,
    private readonly videos: VideoAssetsService,
    private readonly compose: ComposeService,
    private readonly extras: CoverCaptionsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: RENDER_JOB,
      group: 'media',
      payload: RenderPayload,
      run: async ({ renderId }, ctx) => {
        try {
          await this.render(renderId, (f, m) => ctx.progress(f, m), ctx.signal);
        } catch (error) {
          await this.prisma.render.update({
            where: { id: renderId },
            data: { status: 'failed', finishedAt: new Date(), warnings: toJson([error instanceof Error ? error.message : String(error)]) },
          });
          throw error;
        }
        return { renderId };
      },
    });
  }

  async start(projectId: string): Promise<JobDto> {
    await this.projects.find(projectId);
    const scenes = await this.prisma.scene.count({ where: { projectId } });
    const segments = await this.prisma.segment.count({ where: { projectId } });
    if (!segments || segments < scenes) throw new BadRequestException('Approve a video window for every scene first (step 6).');
    const render = await this.prisma.render.create({
      data: { projectId, status: 'queued', settings: toJson({}), outputDir: '', warnings: toJson([]) },
    });
    const outputDir = `projects/${projectId}/renders/${render.id}`;
    await this.prisma.render.update({ where: { id: render.id }, data: { outputDir } });
    return this.jobs.enqueue(RENDER_JOB, { renderId: render.id }, { projectId });
  }

  private async plan(projectId: string, dir: string, warnings: string[]): Promise<RenderPlan> {
    const segments = await this.compose.segments(projectId);
    const zone = await this.compose.zone();
    const segPlans: RenderPlan['segments'] = [];
    for (const s of segments) {
      const badge = await this.compose.badgeFor(s);
      if (!s.asset.normalizedPath) throw new Error(`Scene ${s.scene.order + 1}: its video is still processing.`);
      const text = await this.compose.textOverlay(s, zone);
      warnings.push(...text.warnings.map((w) => `Scene ${s.scene.order + 1}: ${w}`));
      const placement = readJson(z.object({ x: z.number(), y: z.number(), scale: z.number() }).nullable(), s.badgePlacement, null);
      if (s.badgeEnabled && s.placementWarning) warnings.push(`Scene ${s.scene.order + 1}: ${s.placementWarning}`);
      segPlans.push({
        input: this.storage.abs(s.asset.normalizedPath),
        inSec: s.inSec,
        durationSec: Math.round((s.outSec - s.inSec) * 1000) / 1000,
        textPng: text.box ? this.storage.abs(text.rel) : null,
        badge:
          s.badgeEnabled && placement && badge
            ? { png: this.storage.abs(badge.rel), x: placement.x, y: placement.y, w: badge.w * placement.scale, h: badge.h * placement.scale }
            : null,
      });
    }

    const cta = await this.compose.cta(projectId);
    const bg = await this.compose.ctaBackground(projectId);
    let ctaPlan: RenderPlan['cta'] = null;
    if (bg && cta.durationSec > 0) {
      const overlay = renderCtaOverlay(cta.text, zone);
      warnings.push(...overlay.warnings.map((w) => `CTA: ${w}`));
      const overlayRel = `${dir}/work/cta.png`;
      const pointerRel = `${dir}/work/cta-pointer.png`;
      await this.storage.writeAtomic(overlayRel, overlay.png);
      await this.storage.writeAtomic(pointerRel, overlay.pointer.png);
      ctaPlan = {
        background: await this.videos.frameFull(bg.assetId, bg.t),
        durationSec: cta.durationSec,
        zoom: cta.zoom,
        darken: cta.darken,
        overlayPng: this.storage.abs(overlayRel),
        pointer: { png: this.storage.abs(pointerRel), x: overlay.pointer.x, y: overlay.pointer.y },
      };
    }
    const comp = await this.compose.composition(projectId);
    const music = readJson(MusicSchema.nullable(), comp.music, null);
    return {
      segments: segPlans,
      cta: ctaPlan,
      music: music ? { path: this.storage.abs(music.path), fadeOutSec: 2, targetLufs: -14 } : null,
      output: this.storage.abs(`${dir}/final.mp4`),
    };
  }

  private async render(renderId: string, progress: (f: number, m: string) => Promise<void>, signal: AbortSignal): Promise<void> {
    const render = await this.find(renderId);
    const projectId = render.projectId;
    const dir = render.outputDir;
    await this.storage.removeDir(dir);
    await this.prisma.render.update({ where: { id: renderId }, data: { status: 'running' } });
    const warnings: string[] = [];

    await progress(0.03, 'Preparing overlays');
    const plan = await this.plan(projectId, dir, warnings);
    const total = totalDuration(plan);
    await this.prisma.render.update({ where: { id: renderId }, data: { settings: toJson(plan) } });

    await progress(0.05, 'Rendering');
    let last = 0;
    await fs.mkdir(path.dirname(plan.output), { recursive: true });
    await this.media.run('ffmpeg', buildRenderArgs(plan), projectId, signal, (line) => {
      const t = progressSeconds(line);
      if (t === null) return;
      const fraction = 0.05 + 0.8 * Math.min(1, t / total);
      if (fraction - last > 0.04) {
        last = fraction;
        void progress(fraction, `Rendering ${t.toFixed(1)} / ${total.toFixed(1)} s`);
      }
    });

    await progress(0.87, 'Quality checks');
    const probeOut = await this.media.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', plan.output], projectId);
    const probe = parseFinalProbe(probeOut.stdout);
    const format = readJson(z.enum(STORY_FORMATS), (await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } })).format, 'classic');
    const checks: QaCheckDto[] = qaChecks(probe, total, FORMATS[format].reelSec);
    const joins = joinTimes(plan);
    const black = await this.blackFrames(plan.output, joins, projectId);
    checks.push({
      label: 'No black frames at the joins',
      ok: !black.some((b) => b.nearJoin),
      detail: black.length ? black.map((b) => `${b.start.toFixed(2)}–${b.end.toFixed(2)} s${b.nearJoin ? ' (join)' : ''}`).join(', ') : 'none',
    });
    for (const c of checks) if (!c.ok) warnings.push(`QA: ${c.label} — ${c.detail}`);

    await progress(0.92, 'Contact sheet and export files');
    const mids = [
      ...plan.segments.map((s, i) => ({ t: (i === 0 ? 0 : joins[i - 1]) + s.durationSec / 2, label: `Scene ${i + 1}` })),
      ...(plan.cta ? [{ t: joins[joins.length - 1] + plan.cta.durationSec / 2, label: 'CTA' }] : []),
    ];
    const sheetRel = `${dir}/contact_sheet.jpg`;
    await this.contactSheet(plan.output, mids, sheetRel, projectId);
    await this.writeExportFiles(projectId, dir, warnings);
    await this.storage.writeAtomic(`${dir}/qa.json`, JSON.stringify({ probe, checks, blackFrames: black, warnings }, null, 2));
    await this.storage.removeDir(`${dir}/work`);

    await this.prisma.render.update({
      where: { id: renderId },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        probe: toJson(probe),
        qa: toJson({ checks, blackFrames: black, contactSheet: sheetRel }),
        warnings: toJson([...new Set(warnings)]),
      },
    });
    await this.projects.reach(projectId, 'rendered');
  }

  private async blackFrames(file: string, joins: number[], projectId: string): Promise<BlackInterval[]> {
    const result = await this.media.run('ffmpeg', blackdetectArgs(file), projectId);
    return parseBlackdetect(result.stderr, joins);
  }

  /** Middle frame of each segment and of the CTA, in a labelled grid. */
  private async contactSheet(video: string, frames: Array<{ t: number; label: string }>, rel: string, projectId: string): Promise<void> {
    const cols = Math.min(4, frames.length);
    const rows = Math.ceil(frames.length / cols);
    const w = 270;
    const h = 480;
    const canvas = createCanvas(cols * w + (cols + 1) * 12, rows * (h + 34) + (rows + 1) * 12);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [i, f] of frames.entries()) {
      const tmp = this.storage.tmpPath('.jpg');
      await this.media.frameAt(video, f.t, tmp, projectId, 960);
      const img = await loadImage(await fs.readFile(tmp));
      await this.storage.discardTemp(tmp);
      const x = 12 + (i % cols) * (w + 12);
      const y = 12 + Math.floor(i / cols) * (h + 46);
      ctx.drawImage(img, x, y, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px sans-serif';
      ctx.fillText(`${f.label} · ${f.t.toFixed(1)} s`, x, y + h + 26);
    }
    await this.storage.writeAtomic(rel, canvas.toBuffer('image/jpeg', 85));
  }

  private async writeExportFiles(projectId: string, dir: string, warnings: string[]): Promise<void> {
    const cover = await this.extras.coverFiles(projectId);
    if (cover.plain && (await this.storage.exists(cover.plain))) await this.storage.copyInto(cover.plain, `${dir}/cover.jpg`);
    else warnings.push('No cover yet: pick one in step 7.');
    if (cover.titled && (await this.storage.exists(cover.titled))) await this.storage.copyInto(cover.titled, `${dir}/cover_titled.jpg`);
    const captions = await this.extras.captions(projectId);
    if (captions) {
      await this.storage.writeAtomic(`${dir}/caption.txt`, `${captions.caption}\n`);
      await this.storage.writeAtomic(`${dir}/dm_template.txt`, `${captions.dmTemplate}\n`);
      if (captions.firstComment) await this.storage.writeAtomic(`${dir}/first_comment.txt`, `${captions.firstComment}\n`);
    } else {
      warnings.push('No caption package yet: generate it in step 7.');
    }
  }

  // ---------- reads ----------

  async list(projectId: string): Promise<RenderDto[]> {
    const renders = await this.prisma.render.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 });
    const jobs = await this.prisma.job.findMany({ where: { projectId, type: RENDER_JOB }, orderBy: { createdAt: 'desc' }, take: 30 });
    return Promise.all(
      renders.map((r) => {
        const job = jobs.find((j) => readJson(RenderPayload, j.payload, { renderId: '' }).renderId === r.id);
        return this.toDto(r, job ? toJobDto(job) : null);
      }),
    );
  }

  async files(render: Render): Promise<Array<{ name: string; rel: string; bytes: number }>> {
    if (render.status !== 'succeeded') return [];
    const out = [];
    for (const name of FILE_ORDER) {
      const rel = `${render.outputDir}/${name}`;
      if (await this.storage.exists(rel)) out.push({ name, rel, bytes: (await fs.stat(this.storage.abs(rel))).size });
    }
    return out;
  }

  private async toDto(r: Render, job: JobDto | null): Promise<RenderDto> {
    const qa = readJson(QaSchema.nullable(), r.qa, null);
    const status = readJson(z.enum(JOB_STATUSES), job?.status === 'failed' ? 'failed' : r.status, 'queued');
    const files = await this.files(r);
    return {
      id: r.id,
      status,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationSec: readJson(z.object({ durationSec: z.number() }).nullable(), r.probe, null)?.durationSec ?? null,
      files: files.map((f) => ({ name: f.name, url: this.storage.url(f.rel)!, bytes: f.bytes })),
      zipUrl: files.length ? this.storage.apiUrl(`/renders/${r.id}/export.zip`) : null,
      qa: qa ? { checks: qa.checks, blackFrames: qa.blackFrames, contactSheetUrl: this.storage.url(qa.contactSheet) } : null,
      warnings: readJson(z.array(z.string()), r.warnings, []),
      error: job?.status === 'failed' ? job.error : null,
      progress: job?.progress ?? (r.status === 'succeeded' ? 1 : 0),
      message: job?.message ?? '',
    };
  }

  async find(renderId: string): Promise<Render> {
    const r = await this.prisma.render.findUnique({ where: { id: renderId } });
    if (!r) throw new NotFoundException('Render not found');
    return r;
  }
}
