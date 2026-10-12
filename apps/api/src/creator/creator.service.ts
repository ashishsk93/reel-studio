import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  CREATOR_TASK_STATUSES,
  IMAGE_MODELS,
  REF_TAGS,
  creatorPromptChecked,
  type CreatorTaskDto,
  type CreatorTaskUpdate,
  type JobDto,
} from '@reel/shared';
import type { CreatorTask, Influencer, ReferenceImage } from '../generated/prisma/client';
import { readJson } from '../common/json';
import { AssetsService } from '../assets/assets.service';
import { personaOf, refTags, toReferenceDto } from '../influencers/influencer.mapper';
import { JobsService } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { SelectedAttachment } from '../storyboard/reference-rules';
import { FRAMES, frameCard, frameFor, requiredSentences } from './creator-plan';

export const CREATOR_PROMPT_JOB = 'creator.prompt';
const PromptPayload = z.object({ taskId: z.string(), instruction: z.string() });

type InfluencerWithRefs = Influencer & { references: ReferenceImage[] };

/**
 * Character creator, step 2: the reference-image plan. One task per frame (anchor first);
 * uploads go through the same review pipeline as scene images, and an approved frame
 * becomes a tagged reference image.
 */
@Injectable()
export class CreatorService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly storage: StorageService,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: CREATOR_PROMPT_JOB,
      group: 'llm',
      payload: PromptPayload,
      run: async ({ taskId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Rewriting the frame prompt');
        await this.rewrite(taskId, instruction);
        return { taskId };
      },
    });
  }

  /** Creates the frames that don't exist yet. Frames whose tag is already covered start approved. */
  async plan(influencerId: string): Promise<CreatorTaskDto[]> {
    const inf = await this.influencer(influencerId);
    const existing = await this.prisma.creatorTask.findMany({ where: { influencerId } });
    const covered = new Set(inf.references.flatMap((r) => refTags(r)));
    for (const [order, frame] of FRAMES.entries()) {
      if (existing.some((t) => t.tag === frame.tag)) continue;
      await this.prisma.creatorTask.create({
        data: {
          influencerId,
          order,
          tag: frame.tag,
          purpose: frame.purpose,
          prompt: '',
          imageModel: frame.imageModel,
          modelReason: frame.modelReason,
          attachments: [],
          status: covered.has(frame.tag) ? 'approved' : 'ready',
        },
      });
    }
    return this.list(influencerId);
  }

  async list(influencerId: string): Promise<CreatorTaskDto[]> {
    const inf = await this.influencer(influencerId);
    const tasks = await this.prisma.creatorTask.findMany({ where: { influencerId }, orderBy: { order: 'asc' } });
    return Promise.all(tasks.map((t) => this.toDto(t, inf)));
  }

  async get(taskId: string): Promise<CreatorTaskDto> {
    const task = await this.find(taskId);
    return this.toDto(task, await this.influencer(task.influencerId));
  }

  async update(taskId: string, data: CreatorTaskUpdate): Promise<CreatorTaskDto> {
    const task = await this.find(taskId);
    const override = data.prompt !== undefined ? true : (data.promptOverride ?? task.promptOverride);
    await this.prisma.creatorTask.update({
      where: { id: taskId },
      data: {
        prompt: data.prompt ?? task.prompt,
        promptOverride: override,
        imageModel: data.imageModel,
        status: data.status,
      },
    });
    return this.get(taskId);
  }

  async startRewrite(taskId: string, instruction: string | undefined): Promise<JobDto> {
    await this.find(taskId);
    if (!instruction?.trim()) throw new BadRequestException('Describe the change; to reset the prompt, turn off "edited".');
    return this.jobs.enqueue(CREATOR_PROMPT_JOB, { taskId, instruction: instruction.trim() });
  }

  async upload(taskId: string, files: Express.Multer.File[]) {
    const task = await this.find(taskId);
    const inf = await this.influencer(task.influencerId);
    if (task.tag !== 'anchor' && !inf.references.some((r) => refTags(r).includes('anchor'))) {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
      throw new BadRequestException('Approve the anchor first: every other frame is checked against it.');
    }
    const { prompt } = this.card(task, inf);
    return this.assets.upload({ creatorTaskId: taskId }, files, prompt);
  }

  /** Prompt + attachments for the zip download. */
  async attachments(taskId: string): Promise<{ task: CreatorTask; prompt: string; attachments: SelectedAttachment[] }> {
    const task = await this.find(taskId);
    const inf = await this.influencer(task.influencerId);
    const { prompt, attachments } = this.card(task, inf);
    return { task, prompt, attachments };
  }

  // ---------- internals ----------

  private card(task: CreatorTask, inf: InfluencerWithRefs) {
    const persona = { ...inf, ...personaOf(inf) };
    // A frame never attaches the reference it produced itself.
    const refs = inf.references
      .filter((r) => r.creatorTaskId !== task.id)
      .map((r) => ({ id: r.id, tags: refTags(r), path: r.path, sortOrder: r.sortOrder }));
    return frameCard(task, persona, refs, this.prompts);
  }

  private async rewrite(taskId: string, instruction: string): Promise<void> {
    const task = await this.find(taskId);
    const inf = await this.influencer(task.influencerId);
    const card = this.card(task, inf);
    const persona = { ...inf, ...personaOf(inf) };
    const required = requiredSentences(persona, card.frame, card.attachments.length);
    const result = await this.llm.call({
      task: 'creator_prompt',
      schema: creatorPromptChecked(required),
      system: [this.prompts.render('creator-prompt')],
      content: [
        {
          type: 'text',
          text: [
            `Frame: ${task.tag} (${card.frame.purpose})`,
            `Attached images: ${card.attachments.map((a) => `image ${a.index} = ${a.label}`).join(', ') || 'none'}`,
            '',
            'Required sentences (keep verbatim):',
            ...required.map((r) => `- ${r}`),
            '',
            'Current prompt:',
            card.prompt,
            '',
            `Instruction: ${instruction}`,
          ].join('\n'),
        },
      ],
      influencerId: inf.id,
    });
    await this.prisma.creatorTask.update({ where: { id: taskId }, data: { prompt: result.data.prompt.trim(), promptOverride: true } });
  }

  private async toDto(task: CreatorTask, inf: InfluencerWithRefs): Promise<CreatorTaskDto> {
    const card = this.card(task, inf);
    const tag = readJson(z.enum(REF_TAGS), task.tag, 'lifestyle');
    const hasAnchor = inf.references.some((r) => refTags(r).includes('anchor'));
    let status = readJson(z.enum(CREATOR_TASK_STATUSES), task.status, 'ready');
    if (tag !== 'anchor' && !hasAnchor && status === 'ready') status = 'locked';
    const reference =
      inf.references.find((r) => r.creatorTaskId === task.id) ??
      [...inf.references].sort((a, b) => a.sortOrder - b.sortOrder).find((r) => refTags(r).includes(tag)) ??
      null;
    return {
      id: task.id,
      influencerId: task.influencerId,
      order: task.order,
      tag,
      purpose: task.purpose,
      status,
      imageModel: readJson(z.enum(IMAGE_MODELS), task.imageModel, card.frame.imageModel),
      modelReason: task.modelReason,
      aspect: card.frame.aspect,
      tips: card.frame.tips,
      promptOverride: task.promptOverride,
      card: {
        prompt: card.prompt,
        attachments: card.attachments.map((a) => ({
          index: a.index,
          label: a.label,
          kind: a.kind,
          id: a.id,
          url: this.storage.url(a.path),
          fileName: a.fileName,
        })),
        missing: card.missing,
        notes: card.notes,
      },
      reference: reference ? toReferenceDto(reference, this.storage) : null,
      assets: await this.assets.listFor({ creatorTaskId: task.id }),
    };
  }

  private async find(taskId: string): Promise<CreatorTask> {
    const task = await this.prisma.creatorTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Character frame not found');
    if (!frameFor(task.tag)) throw new BadRequestException(`Unknown frame "${task.tag}"`);
    return task;
  }

  private async influencer(id: string): Promise<InfluencerWithRefs> {
    const inf = await this.prisma.influencer.findUnique({ where: { id }, include: { references: true } });
    if (!inf) throw new NotFoundException('Influencer not found');
    return inf;
  }
}
