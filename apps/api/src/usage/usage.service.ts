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
    const calls = await this.prisma.llmCall.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        projectId: range.projectId,
      },
      orderBy: { createdAt: 'desc' },
    });
    const projectIds = [...new Set(calls.flatMap((c) => (c.projectId ? [c.projectId] : [])))];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, productTitle: true },
    });
    const titles = new Map(projects.map((p) => [p.id, p.productTitle]));

    const total = emptyRow('total', 'Total');
    const byMonth = new Map<string, UsageRow>();
    const byProject = new Map<string, UsageRow>();
    const byTask = new Map<string, UsageRow>();
    const bucket = (map: Map<string, UsageRow>, key: string, label: string) => {
      let row = map.get(key);
      if (!row) map.set(key, (row = emptyRow(key, label)));
      return row;
    };

    for (const call of calls) {
      add(total, call);
      const month = call.createdAt.toISOString().slice(0, 7);
      add(bucket(byMonth, month, month), call);
      const projectKey = call.projectId ?? 'none';
      add(bucket(byProject, projectKey, call.projectId ? (titles.get(call.projectId) ?? 'Deleted project') : 'Not tied to a project'), call);
      add(bucket(byTask, call.task, sentenceCase(call.task)), call);
    }

    const byCost = (a: UsageRow, b: UsageRow) => b.costUsd - a.costUsd;
    return {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      usdToInr: await this.settings.get('llm.usdToInr'),
      total,
      byMonth: [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key)),
      byProject: [...byProject.values()].sort(byCost),
      byTask: [...byTask.values()].sort(byCost),
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
