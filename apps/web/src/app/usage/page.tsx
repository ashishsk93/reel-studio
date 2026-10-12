"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { UsageRow, UsageSummaryDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { useUsage } from "@/lib/queries";
import { cn } from "@/lib/utils";

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const credits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

const RANGES = {
  month: "This month",
  "30d": "Last 30 days",
  all: "All time",
} as const;
type Range = keyof typeof RANGES;

function rangeDates(range: Range): { from?: string } {
  const now = new Date();
  if (range === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  // Whole days, so the query key stays the same between renders.
  if (range === "30d") return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString() };
  return {};
}

export default function UsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
      <Usage />
    </Suspense>
  );
}

function Usage() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get("project") ?? undefined;
  const [range, setRange] = useState<Range>("month");
  const { data, isPending, error } = useUsage({ ...rangeDates(range), projectId });
  const inr = (n: number) => `₹${(n * (data?.usdToInr ?? 0)).toFixed(2)}`;
  const projectTitle = projectId ? data?.byProject.find((p) => p.key === projectId)?.label : undefined;

  return (
    <>
      <PageHeader
        title="Usage & costs"
        description="Every Claude call is logged with its tokens and cost. Kling credits are estimated from each uploaded video's planned length."
        actions={
          <ToggleGroup value={[range]} onValueChange={(v: string[]) => v[0] && setRange(v[0] as Range)} variant="outline" size="sm">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <ToggleGroupItem key={r} value={r}>
                {RANGES[r]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      {projectId && (
        <div className="-mt-4 mb-6 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project:</span>
          <Badge variant="secondary" className="gap-1">
            {projectTitle ?? "…"}
            <button type="button" aria-label="Show all projects" onClick={() => router.replace("/usage")}>
              <X className="size-3" />
            </button>
          </Badge>
          <Link href={`/projects/${projectId}`} className="text-xs text-primary hover:underline">
            Open project
          </Link>
        </div>
      )}
      {error && <ErrorState error={error} />}
      {isPending || !data ? (
        !error && <Skeleton className="h-64 rounded-xl" />
      ) : data.total.calls === 0 && data.klingCredits === 0 ? (
        <EmptyState title={range === "all" ? "No Claude calls yet" : `Nothing in ${RANGES[range].toLowerCase()}`}>
          {range === "all" ? "Costs appear here once you analyse a product or draft a persona." : (
            <Button variant="link" onClick={() => setRange("all")}>
              Show all time
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Claude cost" value={usd(data.total.costUsd)} sub={inr(data.total.costUsd)} />
            <Stat
              label="Calls"
              value={String(data.total.calls)}
              sub={data.failedCalls ? `${data.failedCalls} failed` : "none failed"}
              warn={data.failedCalls > 0}
            />
            <Stat label="Prompt cache" value={`${Math.round(data.cacheHitRate * 100)}%`} sub={`${tokens(data.total.cacheReadTokens)} tokens read from cache`} />
            <Stat label="Kling credits (est.)" value={credits(data.klingCredits)} sub="uploaded generations" />
            <Stat
              label="Claude cost per Reel"
              value={data.reels.count ? usd(data.reels.avgCostUsd) : "–"}
              sub={data.reels.count ? `${data.reels.count} rendered · ${inr(data.reels.avgCostUsd)}` : "no Reel rendered yet"}
            />
          </div>

          {data.byDay.length > 1 && <DailyChart days={data.byDay} inr={inr} />}

          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown title="By task" rows={data.byTask} inr={inr} />
            <Breakdown title="By model" rows={data.byModel} inr={inr} />
          </div>
          {!projectId && (
            <Breakdown
              title="By project"
              rows={data.byProject}
              inr={inr}
              kling
              link={(r) => (r.key !== "none" && r.exists ? `/usage?project=${r.key}` : null)}
            />
          )}
          {range === "all" && <Breakdown title="By month" rows={data.byMonth} inr={inr} />}

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
                    <TableCell>
                      {c.task.replaceAll("_", " ")}
                      {!c.ok && " (failed)"}
                    </TableCell>
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

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      {sub && <p className={cn("text-xs", warn ? "text-destructive" : "text-muted-foreground")}>{sub}</p>}
    </div>
  );
}

/** Daily Claude spend as simple bars; hover a bar for the numbers. */
function DailyChart({ days, inr }: { days: UsageSummaryDto["byDay"]; inr: (n: number) => string }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0.0001);
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Claude spend per day</h2>
        <span className="text-xs text-muted-foreground">peak {usd(max)}</span>
      </div>
      <div className="flex h-28 items-end gap-[2px]">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${usd(d.costUsd)} (${inr(d.costUsd)}), ${d.calls} call${d.calls === 1 ? "" : "s"}`}
            className={cn("min-w-[3px] flex-1 rounded-t-sm", d.costUsd > 0 ? "bg-primary/70 hover:bg-primary" : "bg-muted")}
            style={{ height: `${Math.max(2, (d.costUsd / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{days[0].date}</span>
        <span>{days[days.length - 1].date}</span>
      </div>
    </section>
  );
}

function Breakdown({
  title,
  rows,
  inr,
  kling,
  link,
}: {
  title: string;
  rows: UsageRow[];
  inr: (n: number) => string;
  kling?: boolean;
  link?: (row: UsageRow) => string | null;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <h2 className="border-b px-5 py-3 text-sm font-semibold">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{title.replace("By ", "")}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            {kling && <TableHead className="text-right">Kling credits</TableHead>}
            <TableHead className="text-right">Claude cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const href = link?.(r);
            return (
              <TableRow key={r.key}>
                <TableCell>
                  {href ? (
                    <Link href={href} className="hover:text-primary hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </TableCell>
                <TableCell className="text-right">{r.calls}</TableCell>
                {kling && <TableCell className="text-right">{r.klingCredits ? credits(r.klingCredits) : "–"}</TableCell>}
                <TableCell className="text-right">
                  {usd(r.costUsd)} <span className="text-xs text-muted-foreground">{inr(r.costUsd)}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
