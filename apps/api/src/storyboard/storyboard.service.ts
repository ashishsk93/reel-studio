import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { z } from 'zod';
import {
  IMAGE_MODELS,
  OUTFIT_STATES,
  PRODUCT_IMAGE_ROLES,
  SCENE_TYPES,
  SHOT_KINDS,
  sceneReviseChecked,
  storyboardChecked,
  type BackgroundDto,
  type JobDto,
  type ProductImageRole,
  type ProductSpecDto,
  type PromptCardDto,
  type SceneCreate,
  type SceneDto,
  type SceneEditable,
  type SceneUpdate,
  type StoryboardConstraints,
  type StoryboardDto,
  type StoryboardScene,
} from '@reel/shared';
import type { Scene } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { personaOf, refTags } from '../influencers/influencer.mapper';
import { JobsService } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { PlaceholderError, buildImagePrompt, type PromptPersona } from './prompt-builder';
import { selectAttachments, type ProductCandidate, type RefCandidate, type RefRules, type SelectedAttachment } from './reference-rules';

export const STORYBOARD_JOB = 'storyboard.generate';
export const SCENE_REVISE_JOB = 'scene.revise';

const GeneratePayload = z.object({ projectId: z.string(), instruction: z.string().optional() });
const RevisePayload = z.object({ sceneId: z.string(), instruction: z.string().optional() });

/** Reel length incl. the CTA, from the brief. */
const REEL_MIN_SEC = 16;
const REEL_MAX_SEC = 20;

interface BoardContext {
  projectId: string;
  persona: PromptPersona & {
    age: number;
    city: string;
    voiceNotes: string;
    personality: string;
    lane: string;
    exampleLines: string[];
    homeSetting: string;
    defaultStyling: string;
  };
  references: RefCandidate[];
  /** Her places: references tagged "background", numbered 1.. in this order for the storyboard. */
  backgrounds: Array<RefCandidate & { note: string }>;
  products: ProductCandidate[];
  spec: ProductSpecDto;
  rules: RefRules;
  maxRefs: Record<string, number>;
  ctaSec: number;
}

export interface BuiltScene {
  prompt: string;
  attachments: SelectedAttachment[];
  card: PromptCardDto;
}

@Injectable()
export class StoryboardService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly product: ProductService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: STORYBOARD_JOB,
      group: 'llm',
      payload: GeneratePayload,
      run: async ({ projectId, instruction }, ctx) => {
        await ctx.progress(0.05, 'Planning scenes');
        const count = await this.generate(projectId, instruction);
        await this.projects.reach(projectId, 'storyboard_ready');
        return { scenes: count };
      },
    });
    this.jobs.register({
      type: SCENE_REVISE_JOB,
      group: 'llm',
      payload: RevisePayload,
      run: async ({ sceneId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Rewriting scene');
        await this.revise(sceneId, instruction);
        return { sceneId };
      },
    });
  }

  // ---------- reads ----------

  async get(projectId: string): Promise<StoryboardDto> {
    const ctx = await this.context(projectId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { scenes: { orderBy: { order: 'asc' } } },
    });
    const scenes = project.scenes.map((s) => this.toDto(s, ctx));
    return {
      scenes,
      backgrounds: ctx.backgrounds.map(
        (b, i): BackgroundDto => ({ id: b.id, number: i + 1, note: b.note, url: this.storage.url(b.path) ?? '' }),
      ),
      notes: readJson(z.array(z.string()), project.storyboardNotes, []),
      totalSec: Math.round(scenes.reduce((sum, s) => sum + s.targetDurationSec, 0) * 10) / 10,
      ctaSec: ctx.ctaSec,
    };
  }

  /** The scene with its current prompt and attachments (rebuilt, so new references count). */
  async sceneAttachments(sceneId: string): Promise<{ scene: Scene } & BuiltScene> {
    const scene = await this.findScene(sceneId);
    const ctx = await this.context(scene.projectId);
    return { scene, ...this.build(ctx, scene) };
  }

  async allAttachments(projectId: string) {
    const ctx = await this.context(projectId);
    const scenes = await this.prisma.scene.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
    return scenes.map((scene) => ({ scene, ...this.build(ctx, scene) }));
  }

  // ---------- jobs ----------

  async startGenerate(projectId: string, instruction?: string, force?: boolean): Promise<JobDto> {
    if (!(await this.product.get(projectId))) throw new BadRequestException('Run the product analysis first.');
    const withUploads = await this.prisma.asset.count({ where: { scene: { projectId } } });
    if (withUploads > 0 && !force) {
      throw new ConflictException(
        `${withUploads} generated image(s) are attached to the current scenes. Regenerating replaces the scenes and their uploads; confirm to continue.`,
      );
    }
    return this.jobs.enqueue(STORYBOARD_JOB, { projectId, instruction }, { projectId });
  }

  async startRevise(sceneId: string, instruction?: string): Promise<JobDto> {
    const scene = await this.findScene(sceneId);
    return this.jobs.enqueue(SCENE_REVISE_JOB, { sceneId, instruction }, { projectId: scene.projectId });
  }

  // ---------- scene edits ----------

  async createScene(projectId: string, data: SceneCreate): Promise<SceneDto> {
    const ctx = await this.context(projectId);
    const scenes = await this.prisma.scene.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
    const after = data.afterSceneId ? scenes.findIndex((s) => s.id === data.afterSceneId) : scenes.length - 1;
    const order = after + 1;
    const { afterSceneId: _after, ...fields } = data;
    const built = this.buildFromFields(ctx, fields);
    const created = await this.prisma.$transaction(async (tx) => {
      for (const s of scenes.slice(order)) await tx.scene.update({ where: { id: s.id }, data: { order: s.order + 1 } });
      return tx.scene.create({ data: { projectId, order, ...this.columns(fields, built) } });
    });
    return this.toDto(created, ctx);
  }

  async updateScene(sceneId: string, data: SceneUpdate): Promise<SceneDto> {
    const scene = await this.findScene(sceneId);
    const ctx = await this.context(scene.projectId);
    const { imagePrompt, promptOverride, ...fields } = data;
    const merged = { ...this.editable(scene), ...fields };
    const override = imagePrompt !== undefined ? true : (promptOverride ?? scene.promptOverride);
    const built = this.buildFromFields(ctx, merged);
    const updated = await this.prisma.scene.update({
      where: { id: sceneId },
      data: {
        ...this.columns(merged, built),
        imagePrompt: override ? (imagePrompt ?? scene.imagePrompt) : built.prompt,
        promptOverride: override,
      },
    });
    return this.toDto(updated, ctx);
  }

  async deleteScene(sceneId: string): Promise<void> {
    const scene = await this.findScene(sceneId);
    await this.prisma.$transaction(async (tx) => {
      await tx.scene.delete({ where: { id: sceneId } });
      const rest = await tx.scene.findMany({ where: { projectId: scene.projectId }, orderBy: { order: 'asc' } });
      for (const [order, s] of rest.entries()) await tx.scene.update({ where: { id: s.id }, data: { order } });
    });
    await this.storage.removeDir(`projects/${scene.projectId}/scenes/${sceneId}`);
  }

  async reorder(projectId: string, ids: string[]): Promise<StoryboardDto> {
    const scenes = await this.prisma.scene.findMany({ where: { projectId } });
    if (scenes.length !== ids.length || !scenes.every((s) => ids.includes(s.id))) {
      throw new BadRequestException('Send every scene id of this project exactly once.');
    }
    await this.prisma.$transaction(ids.map((id, order) => this.prisma.scene.update({ where: { id }, data: { order } })));
    return this.get(projectId);
  }

  // ---------- generation ----------

  private async generate(projectId: string, instruction?: string): Promise<number> {
    const ctx = await this.context(projectId);
    const project = await this.projects.find(projectId);
    const constraints = this.constraints(ctx);

    const result = await this.llm.call({
      task: 'storyboard',
      schema: storyboardChecked(constraints),
      system: [await this.storyboardSystem(), this.personaBlock(ctx)],
      content: [
        {
          type: 'text',
          text: [
            this.productBlock(ctx, project),
            '',
            '## Constraints',
            `- Back of the product known: ${constraints.backKnown ? 'yes' : 'no (no back views, no full turns)'}`,
            `- Pieces in the set: ${constraints.pieceCount}`,
            `- Product image roles available: ${constraints.availableRoles.join(', ')}`,
            `- Scene durations must add up to ${constraints.minTotalSec}–${constraints.maxTotalSec} s (a ${ctx.ctaSec} s CTA is added after).`,
            '',
            this.placesBlock(ctx),
            '',
            instruction ? `User instruction for this storyboard: ${instruction}` : 'Plan the storyboard.',
          ].join('\n'),
        },
      ],
      projectId,
    });

    const scenes = result.data.scenes.map((scene) => this.fromLlm(ctx, scene));
    const built = scenes.map((scene) => this.buildFromFields(ctx, scene));
    const replaced = await this.prisma.scene.findMany({ where: { projectId }, select: { id: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.scene.deleteMany({ where: { projectId } });
      for (const [order, scene] of scenes.entries()) {
        await tx.scene.create({ data: { projectId, order, ...this.columns(scene, built[order]) } });
      }
      await tx.project.update({ where: { id: projectId }, data: { storyboardNotes: toJson(result.data.notes) } });
    });
    // Uploads of the replaced scenes were deleted with them (the user confirmed); remove their files too.
    for (const { id } of replaced) await this.storage.removeDir(`projects/${projectId}/scenes/${id}`);
    return scenes.length;
  }

  private async revise(sceneId: string, instruction?: string): Promise<void> {
    const scene = await this.findScene(sceneId);
    const ctx = await this.context(scene.projectId);
    const project = await this.projects.find(scene.projectId);
    const others = await this.prisma.scene.findMany({ where: { projectId: scene.projectId }, orderBy: { order: 'asc' } });
    const constraints = this.constraints(ctx);
    const storyboardRules = await this.storyboardSystem();

    const result = await this.llm.call({
      task: 'scene_prompt',
      schema: sceneReviseChecked(constraints),
      system: [this.prompts.render('scene-revise', { storyboardRules }), this.personaBlock(ctx)],
      content: [
        {
          type: 'text',
          text: [
            this.productBlock(ctx, project),
            '',
            '## Constraints',
            `- Back of the product known: ${constraints.backKnown ? 'yes' : 'no'}`,
            `- Product image roles available: ${constraints.availableRoles.join(', ')}`,
            '',
            this.placesBlock(ctx),
            '',
            '## The full storyboard (for consistency)',
            ...others.map((s) => `${s.order + 1}. ${s.type} · ${s.setting} · ${s.outfitState}: ${s.description}`),
            '',
            `## Scene ${scene.order + 1} to revise (JSON)`,
            JSON.stringify(this.toLlm(ctx, this.editable(scene)), null, 2),
            '',
            instruction ? `Instruction: ${instruction}` : 'No instruction: improve the description as described.',
          ].join('\n'),
        },
      ],
      projectId: scene.projectId,
    });

    const fields = this.fromLlm(ctx, result.data.scene);
    const built = this.buildFromFields(ctx, fields);
    await this.prisma.scene.update({
      where: { id: sceneId },
      data: { ...this.columns(fields, built), promptOverride: false },
    });
  }

  // ---------- building ----------

  private async context(projectId: string): Promise<BoardContext> {
    const project = await this.projects.find(projectId);
    const spec = await this.product.get(projectId);
    if (!spec) throw new BadRequestException('Run the product analysis first.');
    const [rules, tools, cta] = await Promise.all([
      this.settings.get('storyboard.refRules'),
      this.settings.get('tools.image'),
      this.settings.get('compose.cta'),
    ]);
    const inf = project.influencer;
    const references = inf.references.map((r) => ({ id: r.id, tags: refTags(r), path: r.path, sortOrder: r.sortOrder, note: r.note }));
    return {
      projectId,
      persona: { ...inf, ...personaOf(inf) },
      references,
      backgrounds: references.filter((r) => r.tags.includes('background')).sort((a, b) => a.sortOrder - b.sortOrder),
      products: project.productImages.map((p) => ({
        id: p.id,
        role: readJson(z.enum(PRODUCT_IMAGE_ROLES), p.role, 'other'),
        order: p.order,
        path: p.path,
      })),
      spec,
      rules,
      maxRefs: Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, v.maxRefs])),
      ctaSec: cta.durationSec,
    };
  }

  private constraints(ctx: BoardContext): StoryboardConstraints {
    return {
      backKnown: ctx.products.some((p) => p.role === 'back'),
      pieceCount: ctx.spec.spec.pieces.length,
      availableRoles: [...new Set(ctx.products.map((p) => p.role))],
      minTotalSec: REEL_MIN_SEC - ctx.ctaSec,
      maxTotalSec: REEL_MAX_SEC - ctx.ctaSec,
      placeCount: ctx.backgrounds.length,
    };
  }

  private placesBlock(ctx: BoardContext): string {
    if (ctx.backgrounds.length === 0) return '## Her places\nNone yet: set `place` to null for every scene.';
    return [
      '## Her places (a photo of each is attached to the image prompt as the background)',
      ...ctx.backgrounds.map((b, i) => `${i + 1}. ${b.note.trim() || 'Her room (no description)'}`),
    ].join('\n');
  }

  /** The storyboard's numbered `place` becomes the background reference id. */
  private fromLlm(ctx: BoardContext, scene: StoryboardScene): SceneEditable {
    const { place, ...rest } = scene;
    return { ...rest, backgroundId: place ? (ctx.backgrounds[place - 1]?.id ?? null) : null };
  }

  private toLlm(ctx: BoardContext, scene: SceneEditable): StoryboardScene {
    const { backgroundId, ...rest } = scene;
    const index = ctx.backgrounds.findIndex((b) => b.id === backgroundId);
    return { ...rest, place: index >= 0 ? index + 1 : null };
  }

  private garmentText(ctx: BoardContext): string {
    const s = ctx.spec.spec;
    return [s.category, s.garmentType, s.neckline.front, s.neckline.back, s.backDetails, ctx.spec.garmentParagraph].join(' ');
  }

  /** Attachments + prompt for a scene's fields. Pure given the context. */
  private buildFromFields(ctx: BoardContext, fields: SceneEditable): BuiltScene {
    const background = fields.backgroundId ? (ctx.backgrounds.find((b) => b.id === fields.backgroundId) ?? null) : null;
    const selection = selectAttachments({
      influencerName: ctx.persona.name,
      shotKind: fields.shotKind,
      showsProduct: fields.showsProduct,
      productRoles: fields.productRoles,
      garmentText: this.garmentText(ctx),
      references: ctx.references,
      products: ctx.products,
      rules: ctx.rules,
      maxRefs: ctx.maxRefs[fields.imageModel] ?? 4,
      background,
    });
    if (fields.backgroundId && !background) selection.missing.push('The background picked for this scene was removed; pick another or none.');
    let prompt: string;
    try {
      prompt = buildImagePrompt(
        {
          persona: ctx.persona,
          scene: fields,
          garmentParagraph: ctx.spec.garmentParagraph,
          personCount: selection.personCount,
          backgroundIndex: selection.backgroundIndex,
        },
        this.prompts,
      );
    } catch (error) {
      if (!(error instanceof PlaceholderError)) throw error;
      prompt = '';
      selection.missing.unshift(error.message);
    }
    return {
      prompt,
      attachments: selection.attachments,
      card: {
        prompt,
        attachments: selection.attachments.map((a) => ({
          index: a.index,
          label: a.label,
          kind: a.kind,
          id: a.id,
          url: this.storage.url(a.path),
          fileName: a.fileName,
        })),
        missing: selection.missing,
        notes: selection.notes,
      },
    };
  }

  /** Rebuilt on every read so new reference uploads show up immediately. */
  private build(ctx: BoardContext, scene: Scene): BuiltScene {
    const built = this.buildFromFields(ctx, this.editable(scene));
    if (!scene.promptOverride) return built;
    return {
      ...built,
      prompt: scene.imagePrompt,
      card: {
        ...built.card,
        prompt: scene.imagePrompt,
        notes: [...built.card.notes, 'Prompt edited by hand: check the image numbering still matches the attachments.'],
      },
    };
  }

  private editable(scene: Scene): SceneEditable {
    return {
      type: readJson(z.enum(SCENE_TYPES), scene.type, 'custom'),
      purpose: scene.purpose,
      shotKind: readJson(z.enum(SHOT_KINDS), scene.shotKind, 'medium'),
      outfitState: readJson(z.enum(OUTFIT_STATES), scene.outfitState, 'own_clothes'),
      showsProduct: scene.showsProduct,
      setting: scene.setting,
      description: scene.description,
      productRoles: readJson(z.array(z.enum(PRODUCT_IMAGE_ROLES)), scene.productRoles, []) as ProductImageRole[],
      onScreenText: scene.onScreenText,
      targetDurationSec: scene.targetDurationSec,
      imageModel: readJson(z.enum(IMAGE_MODELS), scene.imageModel, 'nano_banana'),
      imageModelReason: scene.imageModelReason,
      motion: scene.motion,
      backgroundId: scene.backgroundId,
    };
  }

  private columns(fields: SceneEditable, built: BuiltScene) {
    return {
      type: fields.type,
      purpose: fields.purpose,
      shotKind: fields.shotKind,
      outfitState: fields.outfitState,
      showsProduct: fields.showsProduct,
      setting: fields.setting,
      description: fields.description,
      productRoles: toJson(fields.productRoles),
      onScreenText: fields.onScreenText,
      targetDurationSec: fields.targetDurationSec,
      imageModel: fields.imageModel,
      imageModelReason: fields.imageModelReason,
      motion: fields.motion,
      backgroundId: fields.backgroundId,
      imagePrompt: built.prompt,
      attachments: toJson(built.attachments.map(({ kind, id, label, fileName }) => ({ kind, id, label, fileName }))),
    };
  }

  private toDto(scene: Scene, ctx: BoardContext): SceneDto {
    const built = this.build(ctx, scene);
    return {
      id: scene.id,
      projectId: scene.projectId,
      order: scene.order,
      ...this.editable(scene),
      imagePrompt: built.prompt,
      promptOverride: scene.promptOverride,
      card: built.card,
      updatedAt: scene.updatedAt.toISOString(),
    };
  }

  private async findScene(id: string): Promise<Scene> {
    const scene = await this.prisma.scene.findUnique({ where: { id } });
    if (!scene) throw new NotFoundException('Scene not found');
    return scene;
  }

  // ---------- prompt text ----------

  private async storyboardSystem(): Promise<string> {
    const tools = await this.settings.get('tools.image');
    return this.prompts.render('storyboard', {
      copyRules: this.prompts.render('rules/copy-rules'),
      toolNotes: Object.entries(tools)
        .map(([key, t]) => `- \`${key}\` (${t.label}, up to ${t.maxRefs} reference images): ${t.notes}`)
        .join('\n'),
    });
  }

  private personaBlock(ctx: BoardContext): string {
    const p = ctx.persona;
    return [
      `## The influencer: ${p.name}, ${p.age}, ${p.city}`,
      `Voice: ${p.voiceNotes}`,
      `Personality: ${p.personality}`,
      `Lane: ${p.lane}`,
      `Example lines: ${p.exampleLines.map((l) => `"${l}"`).join(' / ') || '(none)'}`,
      `Her own clothes (home outfit): ${p.homeOutfit}`,
      `Her bedroom / home setting: ${p.homeSetting}`,
      `Default styling: ${p.defaultStyling}`,
    ].join('\n');
  }

  private productBlock(ctx: BoardContext, project: { productTitle: string; occasion: string; source: { displayName: string } }): string {
    return [
      '## Product',
      `Title: ${project.productTitle}`,
      `Store: ${project.source.displayName}`,
      `Occasion / mood: ${project.occasion}`,
      '',
      'Garment paragraph (inserted into prompts automatically):',
      ctx.spec.garmentParagraph,
      '',
      'Spec (JSON):',
      JSON.stringify(ctx.spec.spec),
      '',
      'Must match:',
      ...ctx.spec.mustMatch.map((m) => `- ${m.label}: ${m.expected}`),
      '',
      'Unknown, never show:',
      ...(ctx.spec.unknowns.length ? ctx.spec.unknowns.map((u) => `- ${u}`) : ['- nothing']),
    ].join('\n');
  }
}
