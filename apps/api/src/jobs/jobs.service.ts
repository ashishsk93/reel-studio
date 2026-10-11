import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Subject, filter, type Observable } from 'rxjs';
import type { z } from 'zod';
import type { JobDto, JobEvent, JobStatus } from '@reel/shared';
import type { Job } from '../generated/prisma/client';
import { toJson } from '../common/json';
import { PrismaService } from '../prisma/prisma.service';
import { LogService } from '../storage/log.service';

export type JobGroup = 'llm' | 'media';

export interface JobContext {
  jobId: string;
  projectId: string | null;
  signal: AbortSignal;
  progress(fraction: number, message?: string): Promise<void>;
}

export interface JobHandler<S extends z.ZodType = z.ZodType, R = unknown> {
  type: string;
  group: JobGroup;
  payload: S;
  /** Total tries including the first; LLM handlers retry internally so default to 1. */
  maxAttempts?: number;
  run(payload: z.output<S>, ctx: JobContext): Promise<R>;
}

export interface EnqueueOptions {
  projectId?: string | null;
  /** Re-enqueueing with the same key returns the existing job unless it failed or was cancelled. */
  idempotencyKey?: string;
}

const CONCURRENCY: Record<JobGroup, number> = { llm: 3, media: 1 };
const POLL_MS = 1500;

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status as JobStatus,
    projectId: job.projectId,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result ?? null,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Persistent job queue with an in-process worker. Jobs survive restarts: anything left
 * "running" when the process died is re-queued on boot. Progress is pushed over SSE.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly active = new Map<string, { group: JobGroup; controller: AbortController }>();
  private readonly events = new Subject<JobEvent>();
  private stopped = false;
  private ticking = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogService,
  ) {}

  register<S extends z.ZodType>(handler: JobHandler<S>): void {
    if (this.handlers.has(handler.type)) throw new Error(`Job handler "${handler.type}" registered twice`);
    this.handlers.set(handler.type, handler as unknown as JobHandler);
    this.kick();
  }

  async onApplicationBootstrap(): Promise<void> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'running' },
      data: { status: 'queued', message: 'Resumed after restart' },
    });
    if (count) this.logger.log(`Re-queued ${count} interrupted job(s)`);
    this.schedule();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const { controller } of this.active.values()) controller.abort();
  }

  async enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<JobDto> {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`No job handler for "${type}"`);
    const data = handler.payload.parse(payload);

    if (options.idempotencyKey) {
      const existing = await this.prisma.job.findUnique({ where: { idempotencyKey: options.idempotencyKey } });
      if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') return toJobDto(existing);
      if (existing) {
        const requeued = await this.prisma.job.update({
          where: { id: existing.id },
          data: { status: 'queued', payload: toJson(data), error: null, progress: 0, message: '', finishedAt: null },
        });
        this.emit(requeued);
        this.kick();
        return toJobDto(requeued);
      }
    }

    const job = await this.prisma.job.create({
      data: {
        type,
        payload: toJson(data),
        projectId: options.projectId ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
      },
    });
    this.emit(job);
    this.kick();
    return toJobDto(job);
  }

  async get(id: string): Promise<JobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return toJobDto(job);
  }

  async list(filters: { projectId?: string; status?: string; limit?: number }): Promise<JobDto[]> {
    const jobs = await this.prisma.job.findMany({
      where: { projectId: filters.projectId, status: filters.status },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 50, 200),
    });
    return jobs.map(toJobDto);
  }

  async retry(id: string): Promise<JobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new ConflictException(`Only failed or cancelled jobs can be retried (this one is ${job.status})`);
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: 'queued', error: null, progress: 0, message: 'Retrying', finishedAt: null },
    });
    this.emit(updated);
    this.kick();
    return toJobDto(updated);
  }

  async cancel(id: string): Promise<JobDto> {
    const running = this.active.get(id);
    if (running) running.controller.abort();
    const { count } = await this.prisma.job.updateMany({
      where: { id, status: { in: ['queued', 'running'] } },
      data: { status: 'cancelled', finishedAt: new Date(), message: 'Cancelled' },
    });
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (count) this.emit(job);
    return toJobDto(job);
  }

  stream(projectId?: string): Observable<JobEvent> {
    return this.events.pipe(filter((e) => !projectId || e.job.projectId === projectId));
  }

  /** Wakes the worker immediately instead of waiting for the next poll. */
  private kick(): void {
    if (this.stopped) return;
    setImmediate(() => void this.tick());
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, POLL_MS);
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const queued = await this.prisma.job.findMany({
        where: { status: 'queued', type: { in: [...this.handlers.keys()] } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const job of queued) {
        const handler = this.handlers.get(job.type)!;
        const busy = [...this.active.values()].filter((a) => a.group === handler.group).length;
        if (busy >= CONCURRENCY[handler.group]) continue;
        // Claim atomically so a job never runs twice.
        const claimed = await this.prisma.job.updateMany({
          where: { id: job.id, status: 'queued' },
          data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 }, error: null },
        });
        if (claimed.count === 1) void this.run(job.id, handler);
      }
    } catch (error) {
      this.logger.error(`Worker tick failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async run(jobId: string, handler: JobHandler): Promise<void> {
    const controller = new AbortController();
    this.active.set(jobId, { group: handler.group, controller });
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    this.emit(job);
    this.logs.write('jobs', job.projectId, { event: 'start', jobId, type: job.type, attempt: job.attempts });

    const ctx: JobContext = {
      jobId,
      projectId: job.projectId,
      signal: controller.signal,
      progress: async (fraction, message) => {
        const updated = await this.prisma.job.update({
          where: { id: jobId },
          data: { progress: Math.max(0, Math.min(1, fraction)), ...(message !== undefined ? { message } : {}) },
        });
        this.emit(updated);
      },
    };

    try {
      const result = await handler.run(handler.payload.parse(job.payload), ctx);
      if (controller.signal.aborted) return;
      const done = await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          result: result === undefined ? undefined : toJson(result),
          progress: 1,
          message: 'Done',
          finishedAt: new Date(),
        },
      });
      this.emit(done);
      this.logs.write('jobs', job.projectId, { event: 'succeeded', jobId, type: job.type });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const retry = job.attempts < (handler.maxAttempts ?? 1);
      const failed = await this.prisma.job.update({
        where: { id: jobId },
        data: retry
          ? { status: 'queued', error: message, message: `Retrying after error: ${message}` }
          : { status: 'failed', error: message, message: 'Failed', finishedAt: new Date() },
      });
      this.emit(failed);
      this.logs.write('jobs', job.projectId, { event: retry ? 'retry' : 'failed', jobId, type: job.type, error: message });
      if (!retry) this.logger.warn(`Job ${job.type} ${jobId} failed: ${message}`);
    } finally {
      this.active.delete(jobId);
      this.kick();
    }
  }

  private emit(job: Job): void {
    this.events.next({ kind: 'job', job: toJobDto(job) });
  }
}
