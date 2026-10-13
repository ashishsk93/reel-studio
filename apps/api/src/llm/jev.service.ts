import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmTask } from '@reel/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LogService } from '../storage/log.service';

/** TypeSafe's published price: input tokens only, output is free. */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const TIMEOUT_MS = 15_000;

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string | Record<string, unknown>;
  /** Option → what it means (or null). */
  criteria: Record<string, string | null>;
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: string | Record<string, unknown>;
  /** Ordered level descriptions, lowest first (2–10). */
  criteria: string[];
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion;

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer;

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Jev (TypeSafe AI), a decision model: given a state and typed questions it returns a pick from
 * options we define, with probabilities and a confidence. Text only. Optional: everything that
 * uses it has a fallback, so `ask` returns null when no key is set, in mock/replay mode, or on
 * an error (logged, never thrown).
 */
@Injectable()
export class JevService {
  private readonly logger = new Logger(JevService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly logs: LogService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.jevApiKey) && this.config.llmMode !== 'mock' && this.config.llmMode !== 'replay';
  }

  async ask(request: {
    task: LlmTask;
    state: string | Record<string, unknown> | string[];
    questions: Record<string, JevQuestion>;
    projectId?: string | null;
  }): Promise<Record<string, JevAnswer> | null> {
    if (!this.enabled || Object.keys(request.questions).length === 0) return null;
    const started = Date.now();
    let response: JevResponse | null = null;
    let error: string | null = null;
    let attempts = 0;
    for (const delay of [0, 800, 2400]) {
      attempts++;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await fetch(`${this.config.jevApiUrl}/v1/systemone`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.config.jevApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.config.jevModel, state: request.state, questions: request.questions }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 429 || res.status === 529) {
          error = `Jev ${res.status}: busy`;
          continue;
        }
        if (!res.ok) {
          error = `Jev ${res.status}: ${(await res.text()).slice(0, 300)}`;
          break;
        }
        response = (await res.json()) as JevResponse;
        error = null;
        break;
      } catch (e) {
        error = `Jev request failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const inputTokens = response?.usage?.input_tokens ?? 0;
    const record = await this.prisma.llmCall.create({
      data: {
        task: request.task,
        model: response?.model ?? this.config.jevModel,
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
      provider: 'typesafe-jev',
      latencyMs: record.latencyMs,
      state: request.state,
      questions: request.questions,
      answers: response?.answers ?? null,
      error,
    });
    if (error) this.logger.warn(`${request.task}: ${error}`);
    return response?.answers ?? null;
  }
}
