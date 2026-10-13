import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmTask } from '@reel/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LogService } from '../storage/log.service';
import { StorageService } from '../storage/storage.service';
import { prepareImage } from './image-prep';

/** OpenAI's Decisions pricing: input tokens only; output and caching are free. */
const USD_PER_INPUT_TOKEN = 0.1 / 1_000_000;
const TIMEOUT_MS = 20_000;

/** A text line or an image (a path under DATA_DIR) of the decision's input, in order. */
export type DecisionPart = { type: 'text'; text: string } | { type: 'image'; path: string; label?: string };

export interface PredicateQuestion {
  type: 'predicate';
  name: string;
  instructions: string;
}

export interface ChoiceQuestion {
  type: 'choice';
  name: string;
  instructions: string;
  choices: Array<{ value: string; description: string }>;
}

export interface ScoreQuestion {
  type: 'score';
  name: string;
  instructions: string;
  /** Lowest first. */
  levels: Array<{ label: string; description: string }>;
}

export type DecisionQuestion = PredicateQuestion | ChoiceQuestion | ScoreQuestion;

export interface PredicateAnswer {
  type: 'predicate';
  name: string;
  probability: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  name: string;
  choice: string;
  probabilities: Array<{ value: string; probability: number }>;
  confidence: number;
}

export interface ScoreAnswer {
  type: 'score';
  name: string;
  score: number;
  probabilities: Array<{ value: number; label: string; probability: number }>;
  confidence: number;
}

export interface RefusalAnswer {
  type: 'refusal';
  name: string;
}

export type DecisionAnswer = PredicateAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer;

interface DecisionsResponse {
  model?: string;
  answers?: DecisionAnswer[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * OpenAI's Decisions API (`/v1/decisions`, GPT-6 Luna): typed questions over text and images,
 * answered with a pick and probabilities instead of prose. Used for the few true decisions
 * (copy guardrail, recommended version, badge check, cover frame); everything that writes stays
 * on Claude. Optional: `ask` returns null when no key is set, in mock/replay mode, or on an error
 * (logged, never thrown), and every caller has a fallback.
 */
@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly logs: LogService,
    private readonly storage: StorageService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.openaiApiKey) && this.config.llmMode !== 'mock' && this.config.llmMode !== 'replay';
  }

  /** Answers keyed by question name, or null when decisions are off or the request failed. */
  async ask(request: {
    task: LlmTask;
    input: string | DecisionPart[];
    questions: DecisionQuestion[];
    projectId?: string | null;
  }): Promise<Map<string, DecisionAnswer> | null> {
    if (!this.enabled || request.questions.length === 0) return null;
    const started = Date.now();
    let response: DecisionsResponse | null = null;
    let error: string | null = null;
    let attempts = 0;
    try {
      const input = typeof request.input === 'string' ? request.input : [{ role: 'user', content: await this.content(request.input) }];
      for (const delay of [0, 1000, 3000]) {
        attempts++;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        try {
          const res = await fetch(`${this.config.openaiApiUrl}/v1/decisions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${this.config.openaiApiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: this.config.decisionModel, input, questions: request.questions }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (res.status === 429 || res.status >= 500) {
            error = `Decisions ${res.status}: ${(await res.text()).slice(0, 200)}`;
            continue;
          }
          if (!res.ok) {
            error = `Decisions ${res.status}: ${(await res.text()).slice(0, 300)}`;
            break;
          }
          response = (await res.json()) as DecisionsResponse;
          error = null;
          break;
        } catch (e) {
          error = `Decisions request failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    } catch (e) {
      error = `Decisions input failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    const inputTokens = response?.usage?.input_tokens ?? 0;
    const record = await this.prisma.llmCall.create({
      data: {
        task: request.task,
        model: response?.model ?? this.config.decisionModel,
        projectId: request.projectId ?? null,
        inputTokens,
        outputTokens: response?.usage?.output_tokens ?? 0,
        costUsd: inputTokens * USD_PER_INPUT_TOKEN,
        latencyMs: Date.now() - started,
        attempts,
        ok: Boolean(response),
        error,
      },
    });
    this.logs.write('llm', request.projectId ?? null, {
      callId: record.id,
      task: request.task,
      model: record.model,
      provider: 'openai-decisions',
      latencyMs: record.latencyMs,
      // image parts are paths, never bytes
      input: request.input,
      questions: request.questions,
      answers: response?.answers ?? null,
      error,
    });
    if (error) this.logger.warn(`${request.task}: ${error}`);
    if (!response?.answers) return null;
    return new Map(response.answers.map((a) => [a.name, a]));
  }

  /** Text and inline base64 images (downscaled JPEG), each image preceded by its label. */
  private async content(parts: DecisionPart[]): Promise<Array<Record<string, string>>> {
    const out: Array<Record<string, string>> = [];
    for (const part of parts) {
      if (part.type === 'text') {
        out.push({ type: 'input_text', text: part.text });
        continue;
      }
      if (part.label) out.push({ type: 'input_text', text: part.label });
      const img = await prepareImage(this.storage.abs(part.path));
      out.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.base64}` });
    }
    return out;
  }
}

/** The probability of one choice value (0 when missing). */
export function probabilityOf(answer: ChoiceAnswer, value: string): number {
  return answer.probabilities.find((p) => p.value === value)?.probability ?? 0;
}
