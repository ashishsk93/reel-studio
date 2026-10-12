import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  VIDEO_JOB_PURPOSES,
  VIDEO_MODES,
  videoPromptChecked,
  type ExpectedShotDto,
  type JobDto,
  type PromptCardDto,
  type SettingValue,
  type VideoJobDto,
  type VideoJobUpdate,
  type VideoMode,
} from '@reel/shared';
import type { Asset, Influencer, ProductImage, Project, ReferenceImage, Scene, VideoJob } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { personaOf, refTags } from '../influencers/influencer.mapper';
import { forbiddenReminder, slugify } from '../influencers/persona-text';
import { JobsService } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import type { StoredAttachment } from '../assets/edit-prompt';
import { creditEstimate, planMultiShot, planSingle, type PlanOptions } from './plan';
import { VideoPromptError, buildMultiShotPrompt, buildSinglePrompt, shotMarker } from './video-prompt';

export const VIDEO_PROMPT_JOB = 'video.prompt';
const RewritePayload = z.object({ jobId: z.string(), instruction: z.string() });

export const ExpectedShotsSchema = z.array(
  z.object({
    sceneId: z.string(),
    sceneOrder: z.number(),
    start: z.number(),
    end: z.number(),
    targetSec: z.number(),
    text: z.string(),
  }),
);
const JobSettingsSchema = z.object({ resolution: z.string(), sound: z.boolean(), durationSec: z.number() });

export type SceneWithImage = Scene & { approvedAsset: Asset | null };

export interface VideoContext {
  project: Project & { influencer: Influencer & { references: ReferenceImage[] }; productImages: ProductImage[] };
  persona: { name: string; forbiddenFeatures: string[] };
  scenes: SceneWithImage[];
  anchor: ReferenceImage | null;
  productFront: ProductImage | null;
  template: SettingValue<'video.multiShotTemplate'>;
  tools: SettingValue<'tools.video'>;
}

export interface BuiltJob {
  prompt: string;
  attachments: StoredAttachment[];
  missing: string[];
  notes: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function ext(p: string): string {
  const dot = p.lastIndexOf('.');
  return dot >= 0 ? p.slice(dot) : '.jpg';
}

/** Step 5: Kling video prompts, grouped into multi-shot runs or one per scene. */
@Injectable()
export class VideoService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: VIDEO_PROMPT_JOB,
      group: 'llm',
      payload: RewritePayload,
      run: async ({ jobId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Rewriting the video prompt');
        await this.rewrite(jobId, instruction);
        return { jobId };
      },
    });
  }

  // ---------- context ----------

  async context(projectId: string): Promise<VideoContext> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { influencer: { include: { references: true } }, productImages: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const scenes = await this.prisma.scene.findMany({ where: { projectId }, include: { approvedAsset: true }, orderBy: { order: 'asc' } });
    const [template, tools] = await Promise.all([this.settings.get('video.multiShotTemplate'), this.settings.get('tools.video')]);
    const refs = [...project.influencer.references].sort((a, b) => a.sortOrder - b.sortOrder);
    const products = [...project.productImages].sort((a, b) => a.order - b.order);
    return {
      project,
      persona: { name: project.influencer.name, ...personaOf(project.influencer) },
      scenes,
      anchor: refs.find((r) => refTags(r).includes('anchor')) ?? null,
      productFront: products.find((p) => p.role === 'front') ?? products.find((p) => p.role !== 'back') ?? null,
      template,
      tools,
    };
  }

  planOptions(tools: SettingValue<'tools.video'>): PlanOptions {
    return { maxSec: tools.maxMultiShotSec, minSec: tools.minSec, paddingSec: tools.shotPaddingSec, singleSec: tools.singleShotSec };
  }

  expectedShots(job: VideoJob): ExpectedShotDto[] {
    return readJson(ExpectedShotsSchema, job.expectedShots, []);
  }

  /** Prompt and attachments, rebuilt on read so re-approved images and template edits apply. */
  build(ctx: VideoContext, job: VideoJob): BuiltJob {
    const shots = this.expectedShots(job);
    const scenes = shots.map((s) => ctx.scenes.find((sc) => sc.id === s.sceneId));
    const missing: string[] = [];
    const notes: string[] = [];
    if (scenes.some((s) => !s)) missing.push('A scene of this run was deleted; regenerate the video prompts.');
    const present = scenes.filter((s): s is SceneWithImage => Boolean(s));

    const attachments: StoredAttachment[] = [];
    const first = present[0];
    if (first?.approvedAsset) {
      attachments.push({
        index: 1,
        kind: 'asset',
        id: first.approvedAsset.id,
        path: first.approvedAsset.path,
        label: `Start image (scene ${first.order + 1})`,
        fileName: `1_start_scene${pad2(first.order + 1)}${ext(first.approvedAsset.path)}`,
      });
    } else if (first) {
      missing.push(`Scene ${first.order + 1} has no approved image.`);
    }

    // Element references: the other shots' approved images, then her anchor, then the product.
    const refs: Array<Omit<StoredAttachment, 'index' | 'fileName'> & { name: string }> = [];
    for (const scene of present.slice(1)) {
      if (scene.approvedAsset) {
        refs.push({ kind: 'asset', id: scene.approvedAsset.id, path: scene.approvedAsset.path, label: `Scene ${scene.order + 1} image`, name: `scene${pad2(scene.order + 1)}` });
      }
    }
    if (ctx.anchor) {
      const slug = slugify(ctx.persona.name.split(' ')[0]);
      refs.push({ kind: 'reference', id: ctx.anchor.id, path: ctx.anchor.path, label: `${ctx.persona.name.split(' ')[0]} anchor`, name: `${slug}_anchor` });
    }
    if (ctx.productFront && present.some((s) => s.showsProduct || s.outfitState === 'wearing_product')) {
      refs.push({ kind: 'product', id: ctx.productFront.id, path: ctx.productFront.path, label: `Product ${ctx.productFront.role}`, name: `product_${ctx.productFront.role}` });
    }
    const max = ctx.tools.maxElementRefs;
    if (refs.length > max) notes.push(`Left out to stay within ${max} element references: ${refs.slice(max).map((r) => r.label).join(', ')}.`);
    for (const r of refs.slice(0, max)) {
      const index = attachments.length + 1;
      attachments.push({ index, kind: r.kind, id: r.id, path: r.path, label: r.label, fileName: `${index}_${r.name}${ext(r.path)}` });
    }
    if (attachments.length > 1) {
      notes.unshift(`In Kling: image 1 is the start frame; add images 2–${attachments.length} as element references.`);
    }

    let prompt = job.prompt;
    if (job.promptOverride) {
      notes.push('Prompt edited: check the shot timings still match the plan.');
    } else {
      try {
        prompt =
          job.mode === 'multi_shot'
            ? buildMultiShotPrompt(ctx.template, {
                ...ctx.persona,
                shots: shots.map((s, i) => ({ start: s.start, end: s.end, description: scenes[i]?.description ?? '', motion: scenes[i]?.motion ?? '' })),
              })
            : buildSinglePrompt({ ...ctx.persona, motion: present[0]?.motion ?? '' }, this.prompts);
      } catch (error) {
        if (!(error instanceof VideoPromptError)) throw error;
        prompt = '';
        missing.unshift(error.message);
      }
    }
    if (prompt.length > 2500) notes.push(`The prompt is ${prompt.length} characters; Kling accepts up to 2,500.`);
    return { prompt, attachments, missing, notes };
  }

  toCard(built: BuiltJob): PromptCardDto {
    return {
      prompt: built.prompt,
      attachments: built.attachments.map((a) => ({ index: a.index, label: a.label, kind: a.kind, id: a.id, url: this.storage.url(a.path), fileName: a.fileName })),
      missing: built.missing,
      notes: built.notes,
    };
  }

  jobTitle(job: VideoJob): string {
    const orders = this.expectedShots(job).map((s) => s.sceneOrder + 1);
    const scenes = orders.length > 1 ? `Scenes ${orders[0]}–${orders[orders.length - 1]}` : `Scene ${orders[0] ?? '?'}`;
    if (job.purpose === 'replacement') return `${scenes} (replacement shot)`;
    return job.mode === 'multi_shot' ? `Run ${job.order + 1} · ${scenes}` : scenes;
  }

  toJobDto(ctx: VideoContext, job: VideoJob, assets: VideoJobDto['assets']): VideoJobDto {
    const shots = this.expectedShots(job);
    const settings = readJson(JobSettingsSchema, job.settings, { resolution: '720p', sound: false, durationSec: shots[shots.length - 1]?.end ?? 5 });
    return {
      id: job.id,
      mode: readJson(z.enum(VIDEO_MODES), job.mode, 'multi_shot'),
      purpose: readJson(z.enum(VIDEO_JOB_PURPOSES), job.purpose, 'main'),
      order: job.order,
      active: job.active,
      title: this.jobTitle(job),
      sceneIds: shots.map((s) => s.sceneId),
      durationSec: settings.durationSec,
      expectedShots: shots,
      settings,
      creditEstimate: job.creditEstimate,
      promptOverride: job.promptOverride,
      card: this.toCard(this.build(ctx, job)),
      zipUrl: this.storage.apiUrl(`/video-jobs/${job.id}/attachments.zip`),
      assets,
      approvedAssetId: assets.find((a) => a.status === 'approved')?.id ?? null,
    };
  }

  /** Jobs shown in steps 5–6: the current mode's main jobs, then replacement shots. */
  async visibleJobs(projectId: string, mode: VideoMode): Promise<VideoJob[]> {
    const jobs = await this.prisma.videoJob.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return [
      ...jobs.filter((j) => j.purpose === 'main' && j.mode === mode),
      ...jobs.filter((j) => j.purpose === 'replacement'),
    ];
  }

  // ---------- generation ----------

  async generate(projectId: string, force = false): Promise<void> {
    const ctx = await this.context(projectId);
    if (ctx.scenes.length === 0) throw new BadRequestException('Plan the storyboard first.');
    const missing = ctx.scenes.filter((s) => !s.approvedAssetId).map((s) => s.order + 1);
    if (missing.length) throw new BadRequestException(`Approve an image for scene ${missing.join(', ')} first.`);
    const mode = readJson(z.enum(VIDEO_MODES), ctx.project.videoMode, 'multi_shot');

    const existing = await this.prisma.videoJob.findMany({ where: { projectId, mode, purpose: 'main' }, include: { _count: { select: { assets: true } } } });
    const uploads = existing.reduce((n, j) => n + j._count.assets, 0);
    if (uploads > 0 && !force) {
      throw new ConflictException(`${uploads} video(s) are uploaded for the current ${mode === 'multi_shot' ? 'runs' : 'scenes'}. Regenerating replaces them; confirm to continue.`);
    }

    const options = this.planOptions(ctx.tools);
    const planScenes = ctx.scenes.map((s) => ({ id: s.id, order: s.order, setting: s.setting, outfitState: s.outfitState, targetDurationSec: s.targetDurationSec, onScreenText: s.onScreenText }));
    const plan = mode === 'multi_shot' ? planMultiShot(planScenes, options) : planSingle(planScenes, options);

    await this.prisma.$transaction(async (tx) => {
      await tx.videoJob.deleteMany({ where: { id: { in: existing.map((j) => j.id) } } });
      for (const [order, p] of plan.entries()) {
        const first = ctx.scenes.find((s) => s.id === p.sceneIds[0])!;
        await tx.videoJob.create({
          data: {
            projectId,
            mode,
            purpose: 'main',
            order,
            active: true,
            prompt: '',
            startAssetId: first.approvedAssetId!,
            extraRefs: toJson([]),
            expectedShots: toJson(p.expectedShots),
            settings: toJson({ resolution: ctx.tools.resolution, sound: ctx.tools.sound, durationSec: p.durationSec }),
            creditEstimate: creditEstimate(p.durationSec, ctx.tools.creditsPer5s),
          },
        });
      }
      await tx.videoJob.updateMany({ where: { projectId, purpose: 'main', mode: { not: mode } }, data: { active: false } });
    });
    for (const j of existing) await this.storage.removeDir(`projects/${projectId}/videos/${j.id}`);
    await this.storeBuiltPrompts(projectId);
    await this.projects.reach(projectId, 'video_prompts_ready');
  }

  /** Keeps job.prompt in sync with what is shown (useful as history and for the zip). */
  private async storeBuiltPrompts(projectId: string): Promise<void> {
    const ctx = await this.context(projectId);
    const jobs = await this.prisma.videoJob.findMany({ where: { projectId, promptOverride: false } });
    for (const job of jobs) {
      const { prompt } = this.build(ctx, job);
      if (prompt && prompt !== job.prompt) await this.prisma.videoJob.update({ where: { id: job.id }, data: { prompt } });
    }
  }

  /** Switching keeps the other mode's jobs and uploads; jobs for the new mode are created once. */
  async setMode(projectId: string, mode: VideoMode): Promise<void> {
    await this.projects.find(projectId);
    await this.prisma.project.update({ where: { id: projectId }, data: { videoMode: mode } });
    await this.prisma.videoJob.updateMany({ where: { projectId, purpose: 'main' }, data: { active: false } });
    await this.prisma.videoJob.updateMany({ where: { projectId, purpose: 'main', mode }, data: { active: true } });
    const count = await this.prisma.videoJob.count({ where: { projectId, purpose: 'main', mode } });
    const unapproved = await this.prisma.scene.count({ where: { projectId, approvedAssetId: null } });
    if (count === 0 && unapproved === 0) await this.generate(projectId);
  }

  /** One scene re-generated alone (from a video review fix), kept next to the main runs. */
  async createReplacement(sceneId: string, motion?: string): Promise<VideoJob> {
    const scene = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!scene) throw new NotFoundException('Scene not found');
    if (!scene.approvedAssetId) throw new BadRequestException(`Approve an image for scene ${scene.order + 1} first.`);
    const ctx = await this.context(scene.projectId);
    const [p] = planSingle(
      [{ id: scene.id, order: scene.order, setting: scene.setting, outfitState: scene.outfitState, targetDurationSec: scene.targetDurationSec, onScreenText: scene.onScreenText }],
      this.planOptions(ctx.tools),
    );
    const prompt = motion?.trim() ? buildSinglePrompt({ ...ctx.persona, motion }, this.prompts) : '';
    const job = await this.prisma.videoJob.create({
      data: {
        projectId: scene.projectId,
        mode: 'single',
        purpose: 'replacement',
        order: 100 + scene.order,
        active: true,
        prompt,
        promptOverride: Boolean(prompt),
        startAssetId: scene.approvedAssetId,
        extraRefs: toJson([]),
        expectedShots: toJson(p.expectedShots),
        settings: toJson({ resolution: ctx.tools.resolution, sound: ctx.tools.sound, durationSec: p.durationSec }),
        creditEstimate: creditEstimate(p.durationSec, ctx.tools.creditsPer5s),
      },
    });
    await this.storeBuiltPrompts(scene.projectId);
    return job;
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.find(jobId);
    if (job.purpose !== 'replacement') throw new BadRequestException('Only replacement shots can be deleted; regenerate the prompts instead.');
    await this.prisma.videoJob.delete({ where: { id: jobId } });
    await this.storage.removeDir(`projects/${job.projectId}/videos/${job.id}`);
  }

  async update(jobId: string, data: VideoJobUpdate): Promise<VideoJob> {
    const job = await this.find(jobId);
    const override = data.prompt !== undefined ? true : (data.promptOverride ?? job.promptOverride);
    const updated = await this.prisma.videoJob.update({ where: { id: jobId }, data: { prompt: data.prompt ?? job.prompt, promptOverride: override } });
    if (!override) await this.storeBuiltPrompts(job.projectId);
    return updated;
  }

  async startRewrite(jobId: string, instruction?: string): Promise<JobDto> {
    const job = await this.find(jobId);
    if (!instruction?.trim()) throw new BadRequestException('Describe the change; to reset the prompt, turn off "edited".');
    return this.jobs.enqueue(VIDEO_PROMPT_JOB, { jobId, instruction: instruction.trim() }, { projectId: job.projectId });
  }

  private async rewrite(jobId: string, instruction: string): Promise<void> {
    const job = await this.find(jobId);
    const ctx = await this.context(job.projectId);
    const built = this.build(ctx, job);
    const shots = this.expectedShots(job);
    const reminder = forbiddenReminder(ctx.persona.forbiddenFeatures).replace(/^,\s*/, '');
    const required = [...(job.mode === 'multi_shot' ? shots.map((s, i) => shotMarker(i + 1, s)) : []), reminder].filter(Boolean);
    const result = await this.llm.call({
      task: 'video_prompts',
      schema: videoPromptChecked(required),
      system: [this.prompts.render('video-prompt')],
      content: [
        {
          type: 'text',
          text: [
            `Mode: ${job.mode === 'multi_shot' ? 'Kling multi-shot (one prompt, several shots with hard cuts)' : 'Kling image-to-video, one shot'}`,
            `Duration: ${shots[shots.length - 1]?.end ?? ''} s`,
            '',
            'Keep these verbatim:',
            ...required.map((r) => `- ${r}`),
            '',
            'Current prompt:',
            built.prompt,
            '',
            `Instruction: ${instruction}`,
          ].join('\n'),
        },
      ],
      projectId: job.projectId,
    });
    await this.prisma.videoJob.update({ where: { id: jobId }, data: { prompt: result.data.prompt.trim(), promptOverride: true } });
  }

  async find(jobId: string): Promise<VideoJob> {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Video job not found');
    return job;
  }
}
