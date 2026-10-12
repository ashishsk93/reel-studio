"use client";

import { Check, CircleAlert, Download, Loader2, Minus, RefreshCw, X } from "lucide-react";
import type { AssetDto, Box, CheckGroup, CheckResult, EditPromptDto, IssueSeverity, Verdict } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromptCard } from "@/components/prompt-card";
import { cn } from "@/lib/utils";

export const VERDICT_STYLE: Record<Verdict, { label: string; className: string; dot: string }> = {
  pass: { label: "Pass", className: "bg-emerald-600 text-white", dot: "bg-emerald-500" },
  warn: { label: "Warn", className: "bg-amber-500 text-white", dot: "bg-amber-500" },
  fail: { label: "Fail", className: "bg-destructive text-white", dot: "bg-destructive" },
};

const GROUP_LABEL: Record<CheckGroup, string> = {
  identity: "Identity",
  garment: "Garment",
  anatomy: "Anatomy",
  artefacts: "Artefacts",
  composition: "Composition",
  framing: "Framing",
};

const RESULT_ICON: Record<CheckResult, { icon: typeof Check; className: string; label: string }> = {
  match: { icon: Check, className: "text-emerald-600", label: "match" },
  partial: { icon: Minus, className: "text-amber-600", label: "partial" },
  mismatch: { icon: X, className: "text-destructive", label: "mismatch" },
};

const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  major: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  minor: "border-border bg-muted text-muted-foreground",
};

const TOOL_LABEL: Record<string, string> = { gpt_image: "GPT Image", nano_banana: "Nano Banana" };

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLE[verdict];
  return <Badge className={cn("uppercase", style.className)}>{style.label}</Badge>;
}

/** A paste-ready edit (review fix or assistant answer): prompt, ordered attachments, zip, what to check. */
export function EditPromptCard({ edit, index }: { edit: EditPromptDto; index?: number }) {
  return (
    <PromptCard
      compact
      card={edit.card}
      title={index !== undefined ? `Fix ${index + 1}: ${edit.title}` : edit.title}
      chips={<Badge variant="secondary">{TOOL_LABEL[edit.tool] ?? edit.tool}</Badge>}
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button size="sm" variant="outline" className="self-start" nativeButton={false} render={<a href={edit.zipUrl} />}>
            <Download /> Download attachments (zip)
          </Button>
          {edit.checkAfter.length > 0 && (
            <div className="text-xs">
              <span className="font-medium">Check afterwards: </span>
              <span className="text-muted-foreground">{edit.checkAfter.join(" · ")}</span>
            </div>
          )}
        </div>
      }
    />
  );
}

/** Review state for one asset: reviewing, failed (retry) or the full review. */
export function ReviewCard({
  asset,
  onRetry,
  retrying,
  onHighlight,
}: {
  asset: AssetDto;
  onRetry: () => void;
  retrying?: boolean;
  /** Hovering an issue with a region outlines it on the image. */
  onHighlight?: (box: Box | null) => void;
}) {
  const job = asset.reviewJob;
  if (job && (job.status === "queued" || job.status === "running")) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <div>
          <p className="font-medium">Claude is reviewing version {asset.version}</p>
          <p className="text-xs text-muted-foreground">
            Comparing with the anchor, the references and the product photos. Usually 20–40 seconds.
          </p>
        </div>
      </div>
    );
  }

  const review = asset.review;
  return (
    <div className="flex flex-col gap-4">
      {job?.status === "failed" && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          <p className="flex-1">The review failed: {job.error}</p>
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}
      {!review ? (
        !job && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Not reviewed yet.
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              Review now
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <VerdictBadge verdict={review.verdict} />
              <span className="text-xs text-muted-foreground">
                {review.model} · {new Date(review.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm">{review.summary}</p>
          </div>

          {review.issues.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Issues</h4>
              <ul className="flex flex-col gap-1.5">
                {review.issues.map((issue, i) => (
                  <li
                    key={i}
                    onMouseEnter={() => issue.region && onHighlight?.(issue.region)}
                    onMouseLeave={() => onHighlight?.(null)}
                    className={cn("rounded-lg border px-3 py-2 text-sm", SEVERITY_STYLE[issue.severity], issue.region && "cursor-default")}
                  >
                    <span className="mr-2 text-[11px] font-semibold uppercase">{issue.severity}</span>
                    {issue.description}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Checklist checklist={review.checklist} />

          {review.fixes.length > 0 && (
            <section className="flex flex-col gap-3">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Fix prompts (paste into the image editor with the attachments)
              </h4>
              {review.fixes.map((fix, i) => (
                <EditPromptCard key={i} edit={fix} index={i} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Checklist({ checklist }: { checklist: NonNullable<AssetDto["review"]>["checklist"] }) {
  const groups = [...new Set(checklist.map((c) => c.group))];
  if (groups.length === 0) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {groups.map((group) => (
        <div key={group} className="rounded-xl border bg-card p-3">
          <h4 className="mb-2 text-xs font-semibold">{GROUP_LABEL[group]}</h4>
          <ul className="flex flex-col gap-1.5">
            {checklist
              .filter((c) => c.group === group)
              .map((c, i) => {
                const r = RESULT_ICON[c.result];
                return (
                  <li key={i} className="flex gap-2 text-xs">
                    <r.icon className={cn("mt-0.5 size-3.5 shrink-0", r.className)} aria-label={r.label} />
                    <span>
                      {c.item}
                      {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
