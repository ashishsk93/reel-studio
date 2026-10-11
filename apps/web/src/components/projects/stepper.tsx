"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { STEPS, canOpenStep, isStepDone, type ProjectStatus, type StepKey } from "@reel/shared";
import { cn } from "@/lib/utils";

/** Horizontal 8-step stepper. Any step reached before can be revisited. */
export function Stepper({
  projectId,
  furthest,
  current,
}: {
  projectId: string;
  furthest: ProjectStatus;
  current: StepKey | undefined;
}) {
  return (
    <nav className="mb-8 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 rounded-xl border bg-card p-1.5">
        {STEPS.map((step, i) => {
          const open = canOpenStep(step.key, furthest);
          const done = isStepDone(step.key, furthest);
          const active = step.key === current;
          const body = (
            <>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  active
                    ? "bg-primary-foreground text-primary"
                    : done
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done && !active ? <Check className="size-3" /> : open ? i + 1 : <Lock className="size-3" />}
              </span>
              {step.label}
            </>
          );
          const className = cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
            active ? "bg-primary text-primary-foreground" : open ? "hover:bg-muted" : "cursor-not-allowed text-muted-foreground/60",
          );
          return (
            <li key={step.key}>
              {open ? (
                <Link href={`/projects/${projectId}/${step.key}`} className={className} aria-current={active ? "step" : undefined}>
                  {body}
                </Link>
              ) : (
                <span className={className} title="Finish the earlier steps first">
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
