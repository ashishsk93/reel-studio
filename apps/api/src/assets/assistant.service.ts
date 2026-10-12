import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { assistantChecked, type AssistantMessageDto, type JobDto } from '@reel/shared';
import type { AssistantMessage } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { JobsService } from '../jobs/jobs.service';
import { LlmService, type LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AssetContextService } from './asset-context.service';
import { IssuesSchema, StoredEditPromptSchema, toEditPromptDto } from './asset.mapper';
import { EditPromptError, buildEditPrompt, candidateList, type StoredEditPrompt } from './edit-prompt';

export const ASSISTANT_JOB = 'assistant.reply';
const ReplyPayload = z.object({ assetId: z.string(), messageId: z.string() });

/** Earlier turns sent as context. */
const HISTORY_TURNS = 12;

/** Modification assistant: a chat per asset that turns requested changes into edit prompts. */
@Injectable()
export class AssistantService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly storage: StorageService,
    private readonly context: AssetContextService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: ASSISTANT_JOB,
      group: 'llm',
      payload: ReplyPayload,
      run: async ({ assetId, messageId }, ctx) => {
        await ctx.progress(0.1, 'Writing the edit');
        const reply = await this.reply(assetId, messageId);
        return { assetId, messageId: reply.id };
      },
    });
  }

  async list(assetId: string): Promise<AssistantMessageDto[]> {
    const messages = await this.prisma.assistantMessage.findMany({ where: { assetId }, orderBy: { createdAt: 'asc' } });
    return messages.map((m) => this.toDto(m));
  }

  async send(assetId: string, message: string): Promise<{ message: AssistantMessageDto; job: JobDto }> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    const row = await this.prisma.assistantMessage.create({ data: { assetId, role: 'user', content: message } });
    const job = await this.jobs.enqueue(ASSISTANT_JOB, { assetId, messageId: row.id }, { projectId: asset.projectId });
    return { message: this.toDto(row), job };
  }

  async messageEdit(messageId: string): Promise<StoredEditPrompt> {
    const message = await this.prisma.assistantMessage.findUnique({ where: { id: messageId } });
    const edit = message ? readJson(StoredEditPromptSchema.nullable(), message.output, null) : null;
    if (!edit) throw new NotFoundException('This message has no edit prompt');
    return edit;
  }

  private async reply(assetId: string, messageId: string): Promise<AssistantMessage> {
    const ctx = await this.context.forAsset(assetId);
    const history = await this.prisma.assistantMessage.findMany({ where: { assetId }, orderBy: { createdAt: 'asc' } });
    const index = history.findIndex((m) => m.id === messageId);
    if (index < 0) throw new Error('The message no longer exists');
    const request = history[index];
    const earlier = history.slice(Math.max(0, index - HISTORY_TURNS), index);
    const review = await this.prisma.review.findFirst({ where: { assetId }, orderBy: { createdAt: 'desc' } });

    const content: LlmPart[] = [
      { type: 'text', text: ctx.ownerText },
      { type: 'image', path: ctx.asset.path, label: `IMAGE BEING EDITED (version ${ctx.asset.version}):` },
      ...(ctx.compareImages.length ? [{ type: 'text' as const, text: 'References:' }, ...ctx.compareImages] : []),
      {
        type: 'text',
        text: [
          review
            ? [
                `Latest review: ${review.verdict}. ${review.summary}`,
                ...readJson(IssuesSchema, review.issues, []).map((i) => `- (${i.severity}) ${i.description}`),
              ].join('\n')
            : 'Not reviewed yet.',
          '',
          'Reference keys you can attach:',
          candidateList(ctx.candidates),
          '',
          earlier.length ? 'Conversation so far:' : '',
          ...earlier.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}${this.editSummary(m)}`),
          '',
          `User: ${request.content}`,
        ]
          .filter((l, i, all) => l !== '' || all[i - 1] !== '')
          .join('\n'),
      },
    ];

    const result = await this.llm.call({
      task: 'assistant',
      schema: assistantChecked(ctx.candidates.map((c) => c.key)),
      system: [this.prompts.render('assistant'), ...ctx.contextBlocks],
      content,
      projectId: ctx.projectId,
      influencerId: ctx.influencerId,
    });

    let edit: StoredEditPrompt | null = null;
    let reply = result.data.reply.trim();
    if (result.data.edit) {
      try {
        edit = buildEditPrompt(
          {
            persona: ctx.persona,
            edited: { id: ctx.asset.id, path: ctx.asset.path },
            plan: result.data.edit,
            candidates: ctx.candidates,
            maxRefs: ctx.maxRefs[result.data.edit.tool],
            noPerson: ctx.frame?.tag === 'background',
          },
          this.prompts,
        );
      } catch (error) {
        if (!(error instanceof EditPromptError)) throw error;
        reply = `${reply} (The edit prompt couldn't be assembled: ${error.message})`;
      }
    }
    return this.prisma.assistantMessage.create({
      data: { assetId, role: 'assistant', content: reply, output: edit ? toJson(edit) : undefined },
    });
  }

  /** Earlier edits are summarised so a follow-up ("that didn't work") has context. */
  private editSummary(message: AssistantMessage): string {
    const edit = readJson(StoredEditPromptSchema.nullable(), message.output, null);
    return edit ? `\n  (Edit given: ${edit.title}. Prompt: ${edit.prompt})` : '';
  }

  private toDto(message: AssistantMessage): AssistantMessageDto {
    const edit = readJson(StoredEditPromptSchema.nullable(), message.output, null);
    return {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      edit: edit ? toEditPromptDto(edit, `/assistant-messages/${message.id}/attachments.zip`, this.storage) : null,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
