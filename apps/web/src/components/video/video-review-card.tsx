"use client";

import { useMutation } from "@tanstack/react-query";
import { Clapperboard, Download, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { JobDto, VideoFixDto, VideoReviewDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromptCard } from "@/components/prompt-card";
import { VERDICT_STYLE, VerdictBadge } from "@/components/assets/review-card";
import { api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { cn } from "@/lib/utils";

const SEVERITY: Record<string, string> = {
  critical: "text-destructive",
  major: "text-amber-700 dark:text-amber-400",
  minor: "text-muted-foreground",
};

/** Shot-by-shot video review: verdicts, timed issues (click to seek), and fixes. */
export function VideoReviewCard({
  review,
  jobId,
  sceneLabel,
  onSeek,
  onReplacementCreated,
}: {
  review: VideoReviewDto;
  jobId: string;
  sceneLabel: (sceneId: string) => string;
  onSeek: (t: number) => void;
  onReplacementCreated: () => void | Promise<unknown>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <VerdictBadge verdict={review.verdict} />
          <span className="text-xs text-muted-foreground">
            {review.model} · {new Date(review.createdAt).toLocaleString()}
          </span>
        </div>
        <p className="text-sm">{review.summary}</p>
      </div>

      <ul className="flex flex-col gap-2">
        {review.shots.map((s) => (
          <li key={s.shot} className="rounded-xl border bg-card p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={cn("size-2.5 rounded-full", VERDICT_STYLE[s.verdict].dot)} />
              <span className="font-semibold">
                Shot {s.shot} · {sceneLabel(s.sceneId)}
              </span>
              {!s.matchesScene && <Badge variant="destructive">Doesn&apos;t match the scene</Badge>}
              <button type="button" className="ml-auto font-mono text-xs text-primary hover:underline" onClick={() => onSeek(s.suggestedIn)}>
                suggested {s.suggestedIn.toFixed(2)}–{s.suggestedOut.toFixed(2)} s
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{s.notes}</p>
            {s.issues.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {s.issues.map((issue, i) => (
                  <li key={i} className={cn("text-xs", SEVERITY[issue.severity])}>
                    <span className="font-semibold uppercase">{issue.severity}</span> {issue.description}
                    {issue.fromSec !== null && (
                      <button type="button" className="ml-1 font-mono underline" onClick={() => onSeek(issue.fromSec!)}>
                        @{issue.fromSec.toFixed(2)}s
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {review.fixes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fixes</h4>
          {review.fixes.map((fix, i) => (
            <VideoFixCard key={i} fix={fix} jobId={jobId} onChanged={onReplacementCreated} />
          ))}
        </section>
      )}
    </div>
  );
}


/**
 * A suggested video change (from a review or the modification assistant): a single-scene prompt
 * to add as a replacement shot, or an instruction to rewrite the run's prompt.
 */
export function VideoFixCard({ fix, jobId, onChanged }: { fix: VideoFixDto; jobId: string; onChanged: () => void | Promise<unknown> }) {
  const watch = useJobWatcher();
  const replace = useMutation({
    mutationFn: () => api.post<{ jobId: string }>(`/scenes/${fix.sceneId}/replacement-video-job`, { motion: fix.motion ?? undefined }),
    onSuccess: async () => {
      toast.success("Replacement shot added: generate it, then upload it under its own tab");
      await onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rewrite = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/video-jobs/${jobId}/regenerate-prompt`, { instruction: fix.instruction });
      await watch(job, { label: "Rewriting the video prompt", successMessage: "Prompt rewritten: see Video prompts" });
      await onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const title = `${fix.shot ? `Shot ${fix.shot}: ` : ""}${fix.title}`;
  const checks = fix.checkAfter?.length ? (
    <ul className="list-disc pl-4 text-xs text-muted-foreground">
      {fix.checkAfter.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  ) : null;

  if (fix.card) {
    return (
      <PromptCard
        compact
        card={fix.card}
        title={title}
        chips={<Badge variant="secondary">Regenerate this shot alone</Badge>}
        footer={
          <div className="flex w-full flex-col gap-2">
            <p className="text-xs text-muted-foreground">{fix.instruction}</p>
            {checks}
            <div className="flex flex-wrap gap-2">
              {fix.zipUrl && (
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={fix.zipUrl} />}>
                  <Download /> Download attachments (zip)
                </Button>
              )}
              {fix.sceneId && (
                <Button size="sm" onClick={() => replace.mutate()} disabled={replace.isPending}>
                  <Clapperboard /> Add as replacement shot
                </Button>
              )}
            </div>
          </div>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{fix.instruction}</p>
      {checks}
      {fix.kind === "adjust_prompt" && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => rewrite.mutate()} disabled={rewrite.isPending}>
          {rewrite.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Rewrite the prompt with this
        </Button>
      )}
    </div>
  );
}
