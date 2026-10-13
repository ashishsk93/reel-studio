import { Injectable } from '@nestjs/common';
import type { LlmTask, UsageRow, UsageSummaryDto } from '@reel/shared';
import type { LlmCall } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

function sentenceCase(task: string): string {
  const text = task.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function emptyRow(key: string, label: string): UsageRow {
  return { key, label, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

function add(row: UsageRow, call: LlmCall): void {
  row.calls++;
  row.inputTokens += call.inputTokens;
  row.outputTokens += call.outputTokens;
  row.cacheReadTokens += call.cacheReadTokens;
  row.cacheWriteTokens += call.cacheWriteTokens;
  row.costUsd += call.costUsd;
}

/** Aggregates the LlmCall log in memory; a single user's history is small. */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async summary(range: { from?: Date; to?: Date; projectId?: string }): Promise<UsageSummaryDto> {
    const createdAt = { gte: range.from, lte: range.to };
    const calls = await this.prisma.llmCall.findMany({
      where: { createdAt, projectId: range.projectId },
      orderBy: { createdAt: 'desc' },
    });
    // Each uploaded video is one Kling generation, costed at its job's estimate.
    const videos = await this.prisma.asset.findMany({
      where: { kind: 'video', createdAt, projectId: range.projectId, videoJobId: { not: null } },
      select: { projectId: true, videoJob: { select: { creditEstimate: true } } },
    });
    const renders = await this.prisma.render.findMany({
      where: { status: 'succeeded', createdAt, projectId: range.projectId },
      select: { projectId: true },
    });
    const projectIds = [...new Set([...calls.flatMap((c) => (c.projectId ? [c.projectId] : [])), ...videos.flatMap((v) => (v.projectId ? [v.projectId] : []))])];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, title: true },
    });
    const titles = new Map(projects.map((p) => [p.id, p.title]));

    const total = emptyRow('total', 'Total');
    const byMonth = new Map<string, UsageRow>();
    const byProject = new Map<string, UsageRow>();
    const byTask = new Map<string, UsageRow>();
    const byModel = new Map<string, UsageRow>();
    const byDay = new Map<string, { date: string; calls: number; costUsd: number }>();
    const bucket = (map: Map<string, UsageRow>, key: string, label: string) => {
      let row = map.get(key);
      if (!row) map.set(key, (row = emptyRow(key, label)));
      return row;
    };
    const projectRow = (id: string | null) => {
      const row = bucket(byProject, id ?? 'none', id ? (titles.get(id) ?? 'Deleted project') : 'Not tied to a project');
      if (id) row.exists = titles.has(id);
      return row;
    };

    for (const call of calls) {
      add(total, call);
      const month = call.createdAt.toISOString().slice(0, 7);
      add(bucket(byMonth, month, month), call);
      add(projectRow(call.projectId), call);
      add(bucket(byTask, call.task, sentenceCase(call.task)), call);
      add(bucket(byModel, call.model, call.model), call);
      const date = call.createdAt.toISOString().slice(0, 10);
      const day = byDay.get(date) ?? { date, calls: 0, costUsd: 0 };
      day.calls++;
      day.costUsd += call.costUsd;
      byDay.set(date, day);
    }
    let klingCredits = 0;
    for (const v of videos) {
      const credits = v.videoJob?.creditEstimate ?? 0;
      klingCredits += credits;
      const row = projectRow(v.projectId);
      row.klingCredits = (row.klingCredits ?? 0) + credits;
    }

    // Reels: the projects with a successful render, costed at all their Claude calls in the range.
    const rendered = [...new Set(renders.map((r) => r.projectId))];
    const reelCost = rendered.reduce((sum, id) => sum + (byProject.get(id)?.costUsd ?? 0), 0);
    const inputAll = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;

    const byCost = (a: UsageRow, b: UsageRow) => b.costUsd - a.costUsd;
    return {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      projectId: range.projectId ?? null,
      usdToInr: await this.settings.get('llm.usdToInr'),
      total,
      failedCalls: calls.filter((c) => !c.ok).length,
      cacheHitRate: inputAll ? total.cacheReadTokens / inputAll : 0,
      klingCredits: Math.round(klingCredits * 100) / 100,
      reels: { count: rendered.length, avgCostUsd: rendered.length ? reelCost / rendered.length : 0 },
      byDay: dailySeries(byDay, range.from, range.to),
      byMonth: [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key)),
      byProject: [...byProject.values()].sort(byCost),
      byTask: [...byTask.values()].sort(byCost),
      byModel: [...byModel.values()].sort(byCost),
      recent: calls.slice(0, 50).map((c) => ({
        id: c.id,
        task: c.task as LlmTask,
        model: c.model,
        projectId: c.projectId,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens,
        costUsd: c.costUsd,
        latencyMs: c.latencyMs,
        ok: c.ok,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}

/** Every day from the start of the range (or the first call) to its end, at most the last 60, with zeros filled in. */
export function dailySeries(
  days: Map<string, { date: string; calls: number; costUsd: number }>,
  from?: Date,
  to?: Date,
): Array<{ date: string; calls: number; costUsd: number }> {
  const keys = [...days.keys()].sort();
  const end = to ?? new Date();
  const first = from ?? (keys[0] ? new Date(`${keys[0]}T00:00:00Z`) : end);
  const start = new Date(Math.max(first.getTime(), end.getTime() - 59 * 86_400_000));
  const out: Array<{ date: string; calls: number; costUsd: number }> = [];
  for (let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); t <= end.getTime(); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(days.get(date) ?? { date, calls: 0, costUsd: 0 });
  }
  return out;
}
