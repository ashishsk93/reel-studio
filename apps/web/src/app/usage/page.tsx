"use client";

import { useQuery } from "@tanstack/react-query";
import type { UsageRow, UsageSummaryDto } from "@reel/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/page-header";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function UsagePage() {
  const { data, isPending, error } = useQuery({
    queryKey: keys.usage,
    queryFn: () => api.get<UsageSummaryDto>("/usage"),
    refetchInterval: 30_000,
  });
  const inr = (n: number) => `₹${(n * (data?.usdToInr ?? 0)).toFixed(2)}`;

  return (
    <>
      <PageHeader title="Usage & costs" description="Every Claude call is logged with its tokens and cost." />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {isPending || !data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : data.total.calls === 0 ? (
        <EmptyState title="No Claude calls yet">Costs appear here once you analyse a product or draft a persona.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Total cost" value={usd(data.total.costUsd)} sub={inr(data.total.costUsd)} />
            <Stat label="Calls" value={String(data.total.calls)} />
            <Stat label="Input tokens" value={tokens(data.total.inputTokens)} sub={`${tokens(data.total.cacheReadTokens)} from cache`} />
            <Stat label="Output tokens" value={tokens(data.total.outputTokens)} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown title="By month" rows={data.byMonth} inr={inr} />
            <Breakdown title="By task" rows={data.byTask} inr={inr} />
          </div>
          <Breakdown title="By project" rows={data.byProject} inr={inr} />
          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">Recent calls</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">In / cached / out</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((c) => (
                  <TableRow key={c.id} className={c.ok ? undefined : "text-destructive"}>
                    <TableCell className="text-xs">{new Date(c.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{c.task.replaceAll("_", " ")}{!c.ok && " (failed)"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.model}</TableCell>
                    <TableCell className="text-right text-xs">
                      {tokens(c.inputTokens)} / {tokens(c.cacheReadTokens)} / {tokens(c.outputTokens)}
                    </TableCell>
                    <TableCell className="text-right text-xs">{(c.latencyMs / 1000).toFixed(1)} s</TableCell>
                    <TableCell className="text-right">{usd(c.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Breakdown({ title, rows, inr }: { title: string; rows: UsageRow[]; inr: (n: number) => string }) {
  return (
    <section className="rounded-xl border bg-card">
      <h2 className="border-b px-5 py-3 text-sm font-semibold">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{title.replace("By ", "")}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right">{r.calls}</TableCell>
              <TableCell className="text-right">
                {usd(r.costUsd)} <span className="text-xs text-muted-foreground">{inr(r.costUsd)}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
