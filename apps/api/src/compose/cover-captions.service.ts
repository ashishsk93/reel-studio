import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { z } from 'zod';
import {
  captionsChecked,
  coverPickChecked,
  sceneTextChecked,
  type CaptionPackageDto,
  type CaptionsUpdate,
  type CoverDto,
} from '@reel/shared';
import type { CaptionPackage } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { personaBlock, productBlock } from '../assets/asset-context.service';
import { personaOf } from '../influencers/influencer.mapper';
import { JobsService } from '../jobs/jobs.service';
import { LlmService, type LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { FRAME_H, FRAME_W } from '../overlay/placement';
import { renderTitledCover } from '../overlay/render';
import { VideoAssetsService } from '../video/video-assets.service';
import { ComposeService, drawCover } from './compose.service';

export const COVER_JOB = 'cover.suggest';
export const CAPTIONS_JOB = 'captions.generate';
export const SCENE_TEXT_JOB = 'segment.text';
const ProjectPayload = z.object({ projectId: z.string() });
const SceneTextPayload = z.object({ segmentId: z.string(), instruction: z.string().optional() });

const CoverSchema = z.object({
  candidates: z.array(z.object({ segmentId: z.string(), assetId: z.string(), timeSec: z.number(), label: z.string() })).default([]),
  best: z.number().nullable().default(null),
  reason: z.string().default(''),
  titleOptions: z.array(z.string()).default([]),
  chosen: z.object({ candidate: z.number(), title: z.string() }).nullable().default(null),
  plainPath: z.string().nullable().default(null),
  titledPath: z.string().nullable().default(null),
});
type CoverState = z.infer<typeof CoverSchema>;

export const BRAND_TAG = '#SlayUrbanSociety';
export const CTA_LINE = "Comment LINK and I'll DM you the link 👇";
export const DEFAULT_CHECKLIST = [
  'Turn on the AI label ("Made with AI") when uploading',
  'Add trending audio in Instagram',
  'Paste the caption, then post the first comment',
  'Use cover_titled.jpg as the cover',
  'Share the Reel to your Story',
  'Reply to comments and send the LINK DMs in the first hour',
];

/** Assembles the caption from its parts, with the CTA and the store's disclosure lines. */
export function assembleCaption(parts: { hook: string; outfitLines: string[]; hashtags: string[] }, disclosures: string[]): string {
  return [parts.hook.trim(), ...parts.outfitLines.map((l) => l.trim()), '', CTA_LINE, '', ...disclosures, '', parts.hashtags.join(' ')]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function assembleDm(message: string, link: string | null, disclosure: string | undefined): string {
  return [message.trim(), '', link ?? 'Affiliate link: add it on the Product step, then regenerate', disclosure ? `(${disclosure})` : '']
    .filter((l, i) => l || i === 1)
    .join('\n')
    .trim();
}

/** Step 7: the cover (best frame + titles) and the caption package. */
@Injectable()
export class CoverCaptionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly product: ProductService,
    private readonly videos: VideoAssetsService,
    private readonly compose: ComposeService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: COVER_JOB,
      group: 'llm',
      payload: ProjectPayload,
      run: async ({ projectId }, ctx) => {
        await ctx.progress(0.1, 'Picking the cover frame');
        await this.suggestCover(projectId);
        return { projectId };
      },
    });
    this.jobs.register({
      type: CAPTIONS_JOB,
      group: 'llm',
      payload: ProjectPayload,
      run: async ({ projectId }, ctx) => {
        await ctx.progress(0.1, 'Writing the caption package');
        await this.generateCaptions(projectId);
        return { projectId };
      },
    });
    this.jobs.register({
      type: SCENE_TEXT_JOB,
      group: 'llm',
      payload: SceneTextPayload,
      run: async ({ segmentId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Writing on-screen text options');
        return this.sceneText(segmentId, instruction);
      },
    });
  }

  // ---------- on-screen text options ----------

  async startSceneText(segmentId: string, instruction?: string) {
    const s = await this.compose.findSegment(segmentId);
    return this.jobs.enqueue(SCENE_TEXT_JOB, { segmentId, instruction }, { projectId: s.projectId });
  }

  /** Three new on-screen texts for one segment; the user picks one (nothing is saved here). */
  private async sceneText(segmentId: string, instruction?: string): Promise<{ segmentId: string; options: string[] }> {
    const s = await this.compose.findSegment(segmentId);
    const project = await this.projects.find(s.projectId);
    const spec = await this.product.get(s.projectId);
    const inf = project.influencer;
    const persona = personaOf(inf);
    const others = (await this.compose.segments(s.projectId)).filter((o) => o.id !== s.id);
    const frame = await this.videos.frameFull(s.assetId, (s.inSec + s.outSec) / 2);

    const result = await this.llm.call({
      task: 'scene_text',
      schema: sceneTextChecked([s.onScreenText, ...others.map((o) => o.onScreenText)]),
      system: [
        this.prompts.render('scene-text', { copyRules: this.prompts.render('rules/copy-rules') }),
        [personaBlock(inf), `Voice: ${inf.voiceNotes}`, `Personality: ${inf.personality}`, `Example lines: ${persona.exampleLines.map((l) => `"${l}"`).join(' / ')}`].join('\n'),
        ...(spec ? [productBlock(spec)] : []),
      ],
      content: [
        {
          type: 'text',
          text: [
            `Product title: ${project.productTitle}`,
            `Occasion: ${project.occasion}`,
            '',
            `## Scene ${s.scene.order + 1} (${s.scene.type})`,
            `Purpose: ${s.scene.purpose}`,
            `What happens: ${s.scene.description}`,
            `Current text: "${s.onScreenText}"`,
            '',
            'Texts the other scenes use:',
            ...others.map((o) => `- Scene ${o.scene.order + 1} (${o.scene.type}): "${o.onScreenText}"`),
          ].join('\n'),
        },
        { type: 'image', path: frame, label: 'A frame from this scene:' },
        { type: 'text', text: instruction ? `Instruction: ${instruction}` : 'Write 3 options.' },
      ],
      projectId: s.projectId,
      influencerId: inf.id,
    });
    return { segmentId, options: result.data.options.map((o) => o.trim()) };
  }

  // ---------- cover ----------

  private async coverState(projectId: string): Promise<CoverState> {
    const comp = await this.compose.composition(projectId);
    return readJson(CoverSchema, comp.cover, CoverSchema.parse({}));
  }

  async coverDto(projectId: string): Promise<CoverDto> {
    const c = await this.coverState(projectId);
    const candidates = [];
    for (const cand of c.candidates) {
      let url = '';
      try {
        url = this.storage.url(this.storage.rel(await this.videos.frame(cand.assetId, cand.timeSec)))!;
      } catch {
        continue; // its video was deleted
      }
      candidates.push({ ...cand, url });
    }
    return {
      candidates,
      best: c.best,
      reason: c.reason,
      titleOptions: c.titleOptions,
      chosen: c.chosen,
      plainUrl: this.storage.url(c.plainPath),
      titledUrl: this.storage.url(c.titledPath),
    };
  }

  startCover(projectId: string) {
    return this.jobs.enqueue(COVER_JOB, { projectId }, { projectId });
  }

  private async suggestCover(projectId: string): Promise<void> {
    const project = await this.projects.find(projectId);
    const segments = await this.compose.segments(projectId);
    if (!segments.length) throw new Error('Approve the videos first.');
    const candidates: CoverState['candidates'] = [];
    for (const s of segments) {
      const fractions = s.scene.outfitState === 'wearing_product' ? [0.25, 0.5, 0.8] : [0.5];
      for (const f of fractions) {
        candidates.push({
          segmentId: s.id,
          assetId: s.assetId,
          timeSec: Math.round((s.inSec + f * (s.outSec - s.inSec)) * 1000) / 1000,
          label: `scene ${s.scene.order + 1} (${s.scene.type})`,
        });
      }
    }
    const picked = candidates.slice(0, 12);
    const parts: LlmPart[] = [];
    for (const [i, c] of picked.entries()) {
      parts.push({ type: 'image', path: await this.videos.frame(c.assetId, c.timeSec), label: `Candidate ${i + 1}: ${c.label}` });
    }
    const result = await this.llm.call({
      task: 'cover_pick',
      schema: coverPickChecked(picked.length),
      system: [this.prompts.render('cover-pick', { copyRules: this.prompts.render('rules/copy-rules') }), personaBlock(project.influencer)],
      content: [
        { type: 'text', text: `Product: ${project.productTitle}. Occasion: ${project.occasion}. ${picked.length} candidate frames:` },
        ...parts,
        { type: 'text', text: 'Pick the best cover frame and write 3 titles.' },
      ],
      projectId,
      influencerId: project.influencerId,
    });
    const prev = await this.coverState(projectId);
    const state: CoverState = {
      ...prev,
      candidates: picked,
      best: result.data.best - 1,
      reason: result.data.reason,
      titleOptions: result.data.titles.map((t) => t.trim()),
      chosen: null,
    };
    await this.prisma.composition.update({ where: { projectId }, data: { cover: toJson(state) } });
    // Render the suggestion straight away so there is always a cover.
    await this.chooseCover(projectId, state.best!, state.titleOptions[0]);
  }

  /** Renders cover.jpg (plain) and cover_titled.jpg for a candidate frame and title. */
  async chooseCover(projectId: string, candidate: number, title: string): Promise<void> {
    const state = await this.coverState(projectId);
    const c = state.candidates[candidate];
    if (!c) throw new BadRequestException('Unknown cover frame; suggest a cover first.');
    const canvas = createCanvas(FRAME_W, FRAME_H);
    await drawCover(canvas.getContext('2d'), await this.videos.frameFull(c.assetId, c.timeSec));
    const plain = canvas.toBuffer('image/jpeg', 92);
    // Title at the top of the grid crop unless her face is in the upper part of the frame.
    const segment = await this.prisma.segment.findUnique({ where: { id: c.segmentId } });
    const faces = segment ? this.compose.detections(segment).faces : [];
    const faceHigh = faces.some((f) => f.y < 0.42);
    const titled = await renderTitledCover(plain, title, faceHigh ? 'bottom' : 'top');
    const key = createHash('sha1').update(`${c.assetId}:${c.timeSec}:${title}:${faceHigh}`).digest('hex').slice(0, 10);
    const plainPath = `projects/${projectId}/cover/cover-${key}.jpg`;
    const titledPath = `projects/${projectId}/cover/cover_titled-${key}.jpg`;
    await this.storage.writeAtomic(plainPath, plain);
    await this.storage.writeAtomic(titledPath, titled);
    await this.prisma.composition.update({
      where: { projectId },
      data: { cover: toJson({ ...state, chosen: { candidate, title }, plainPath, titledPath }) },
    });
  }

  async coverFiles(projectId: string): Promise<{ plain: string | null; titled: string | null }> {
    const c = await this.coverState(projectId);
    return { plain: c.plainPath, titled: c.titledPath };
  }

  // ---------- captions ----------

  toCaptionsDto(row: CaptionPackage | null): CaptionPackageDto | null {
    if (!row) return null;
    return {
      caption: row.caption,
      hashtags: readJson(z.array(z.string()), row.hashtags, []),
      firstComment: row.firstComment,
      dmTemplate: row.dmTemplate,
      checklist: readJson(z.array(z.object({ item: z.string(), done: z.boolean() })), row.checklist, []),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async captions(projectId: string): Promise<CaptionPackageDto | null> {
    return this.toCaptionsDto(await this.prisma.captionPackage.findUnique({ where: { projectId } }));
  }

  startCaptions(projectId: string) {
    return this.jobs.enqueue(CAPTIONS_JOB, { projectId }, { projectId });
  }

  private async generateCaptions(projectId: string): Promise<void> {
    const project = await this.projects.find(projectId);
    const spec = await this.product.get(projectId);
    if (!spec) throw new Error('Run the product analysis first.');
    const inf = project.influencer;
    const persona = personaOf(inf);
    const disclosures = readJson(z.array(z.string()), project.source.disclosureLines, []);
    const requiredTags = [BRAND_TAG, inf.hashtag].filter(Boolean);
    const segments = await this.compose.segments(projectId);

    const result = await this.llm.call({
      task: 'captions',
      schema: captionsChecked(requiredTags),
      system: [
        this.prompts.render('captions', { copyRules: this.prompts.render('rules/copy-rules') }),
        [personaBlock(inf), `Voice: ${inf.voiceNotes}`, `Personality: ${inf.personality}`, `Example lines: ${persona.exampleLines.map((l) => `"${l}"`).join(' / ')}`].join('\n'),
        productBlock(spec),
      ],
      content: [
        {
          type: 'text',
          text: [
            `Product title: ${project.productTitle}`,
            `Store: ${project.source.displayName}`,
            `Occasion: ${project.occasion}`,
            `Required hashtags: ${requiredTags.join(' ')}`,
            `On-screen texts in the Reel: ${segments.map((s) => `"${s.onScreenText}"`).join(', ')}`,
            '',
            'Write the caption package.',
          ].join('\n'),
        },
      ],
      projectId,
      influencerId: inf.id,
    });
    const out = result.data;
    const hashtags = [...new Set(out.hashtags.map((h) => h.trim()))];
    const data = {
      caption: assembleCaption({ hook: out.hook, outfitLines: out.outfitLines, hashtags }, disclosures),
      hashtags: toJson(hashtags),
      firstComment: out.firstComment?.trim() || null,
      dmTemplate: assembleDm(out.dmMessage, project.affiliateLink ?? project.productUrl, disclosures[0]),
      coverTitles: toJson([]),
      sceneTexts: toJson(segments.map((s) => ({ sceneId: s.sceneId, text: s.onScreenText }))),
      checklist: toJson(DEFAULT_CHECKLIST.map((item) => ({ item, done: false }))),
    };
    await this.prisma.captionPackage.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
  }

  async updateCaptions(projectId: string, data: CaptionsUpdate): Promise<void> {
    const row = await this.prisma.captionPackage.findUnique({ where: { projectId } });
    if (!row) throw new NotFoundException('Generate the caption package first.');
    await this.prisma.captionPackage.update({
      where: { projectId },
      data: {
        caption: data.caption,
        hashtags: data.hashtags ? toJson(data.hashtags) : undefined,
        firstComment: data.firstComment,
        dmTemplate: data.dmTemplate,
        checklist: data.checklist ? toJson(data.checklist) : undefined,
      },
    });
  }
}
