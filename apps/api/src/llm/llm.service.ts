import { Inject, Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { LlmTask } from '@reel/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LogService } from '../storage/log.service';
import { StorageService } from '../storage/storage.service';
import { prepareImage } from './image-prep';
import { ZERO_USAGE, addUsage, costUsd, type TokenUsage } from './pricing';
import { fingerprintRequest, type LlmTransport } from './transport';

export const LLM_TRANSPORT = Symbol('LLM_TRANSPORT');

export type LlmPart =
  | { type: 'text'; text: string }
  /** `path` is relative to DATA_DIR (or absolute). `label` is sent as text right before the image. */
  | { type: 'image'; path: string; label?: string };

export interface LlmRequest<S extends z.ZodType> {
  task: LlmTask;
  schema: S;
  /** Stable blocks, most stable first: system prompt, persona blocks, template library. The last one gets cache_control. */
  system: string[];
  content: LlmPart[];
  /** "review" uses ANTHROPIC_MODEL_REVIEW, everything else ANTHROPIC_MODEL_DEFAULT. */
  modelKind?: 'default' | 'review';
  projectId?: string | null;
  influencerId?: string | null;
  maxTokens?: number;
}

export interface LlmResult<T> {
  data: T;
  callId: string;
  model: string;
  attempts: number;
  usage: TokenUsage;
  costUsd: number;
}

export class LlmRefusalError extends Error {}
export class LlmOutputError extends Error {}

const MAX_ATTEMPTS = 3; // first try + 2 validation retries

/**
 * The single entry point for Claude calls. Structured output is enforced natively via
 * output_config.format (JSON schema from zod), then re-validated with zod; on failure the
 * validation error is sent back and the call retried up to twice.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger('LLM');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LLM_TRANSPORT) private readonly transport: LlmTransport,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly logs: LogService,
  ) {}

  get mode() {
    return this.transport.mode;
  }

  async call<S extends z.ZodType>(request: LlmRequest<S>): Promise<LlmResult<z.output<S>>> {
    const model = request.modelKind === 'review' ? this.config.modelReview : this.config.modelDefault;
    const effortSetting = await this.settings.get('llm.effort');
    const effort = effortSetting.tasks[request.task] ?? effortSetting.default;

    const system: Anthropic.TextBlockParam[] = request.system
      .filter((text) => text.trim())
      .map((text, i, all) => ({
        type: 'text',
        text,
        ...(i === all.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      }));
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: await this.buildContent(request.content) }];
    const format = zodOutputFormat(request.schema);

    const started = Date.now();
    let usage = ZERO_USAGE;
    let attempts = 0;
    let lastIssue = '';
    let output: z.output<S> | undefined;
    let failure: Error | undefined;

    try {
      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model,
          max_tokens: request.maxTokens ?? 16_000,
          system,
          messages,
          output_config: { format, effort },
        };
        const message = await this.transport.send({ task: request.task, params, fingerprint: fingerprintRequest(params) });
        usage = addUsage(usage, readUsage(message.usage));

        if (message.stop_reason === 'refusal') {
          throw new LlmRefusalError(`The model declined the ${request.task} request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`);
        }

        const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        lastIssue = this.validate(request.schema, text, message.stop_reason);
        if (!lastIssue) {
          output = request.schema.parse(JSON.parse(text)) as z.output<S>;
          break;
        }
        this.logger.warn(`${request.task} attempt ${attempts} invalid: ${lastIssue.split('\n')[0]}`);
        messages.push(
          { role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] },
          {
            role: 'user',
            content: `Your previous output failed validation:\n${lastIssue}\nReturn the complete, corrected JSON object.`,
          },
        );
      }
      if (output === undefined) {
        throw new LlmOutputError(`${request.task}: output still invalid after ${attempts} attempts. ${lastIssue}`);
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    const prices = await this.settings.get('llm.prices');
    if (!prices[model]) this.logger.warn(`No price configured for ${model}; cost logged as 0`);
    const cost = costUsd(usage, prices[model]);
    const record = await this.prisma.llmCall.create({
      data: {
        task: request.task,
        model,
        projectId: request.projectId ?? null,
        influencerId: request.influencerId ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: cost,
        latencyMs: Date.now() - started,
        attempts,
        ok: !failure,
        error: failure?.message ?? null,
      },
    });
    this.logs.write('llm', request.projectId, {
      callId: record.id,
      task: request.task,
      model,
      mode: this.transport.mode,
      effort,
      attempts,
      usage,
      costUsd: cost,
      latencyMs: record.latencyMs,
      system: request.system,
      content: request.content, // image parts are paths, never bytes
      output: output ?? null,
      error: failure?.message ?? null,
    });

    if (failure) throw failure;
    return { data: output!, callId: record.id, model, attempts, usage, costUsd: cost };
  }

  /** Returns '' when valid, otherwise a description of what's wrong for the retry message. */
  private validate(schema: z.ZodType, text: string, stopReason: string | null): string {
    if (stopReason === 'max_tokens') return 'The output was cut off at max_tokens. Be more concise.';
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return `The output is not valid JSON (${error instanceof Error ? error.message : String(error)}).`;
    }
    const result = schema.safeParse(json);
    if (result.success) return '';
    return result.error.issues
      .slice(0, 10)
      .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
  }

  private async buildContent(parts: LlmPart[]): Promise<Anthropic.ContentBlockParam[]> {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const part of parts) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
        continue;
      }
      if (part.label) blocks.push({ type: 'text', text: part.label });
      const abs = /^[a-zA-Z]:[\\/]|^\//.test(part.path) ? part.path : this.storage.abs(part.path);
      const image = await prepareImage(abs);
      blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
    }
    return blocks;
  }
}

function readUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
