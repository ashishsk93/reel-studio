"use client";

import { Loader2 } from "lucide-react";
import type { JobDto } from "@reel/shared";

/** Inline progress for a running job. */
export function JobBanner({ job, label }: { job: JobDto; label: string }) {
  const pct = Math.round(job.progress * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Loader2 className="size-4 animate-spin text-primary" />
      <div className="flex-1">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {job.status === "queued" ? "Queued" : job.message || "Working"}
          {pct > 0 && ` · ${pct}%`}
        </p>
      </div>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(5, pct)}%` }} />
      </div>
    </div>
  );
}
