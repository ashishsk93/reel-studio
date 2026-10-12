"use client";

import type { ExpectedShotDto } from "@reel/shared";
import { cn } from "@/lib/utils";

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** The planned shots of a run as a proportional bar: scene number, timing, on-screen text. */
export function ShotPlan({ shots, durationSec }: { shots: ExpectedShotDto[]; durationSec: number }) {
  return (
    <div className="flex h-12 w-full overflow-hidden rounded-lg border text-[11px]">
      {shots.map((shot, i) => (
        <div
          key={shot.sceneId}
          className={cn("flex min-w-0 flex-col justify-center border-r px-2 last:border-r-0", i % 2 ? "bg-primary/10" : "bg-primary/5")}
          style={{ width: `${((shot.end - shot.start) / durationSec) * 100}%` }}
          title={shot.text}
        >
          <span className="truncate font-semibold">
            Shot {i + 1} · scene {shot.sceneOrder + 1}
          </span>
          <span className="truncate text-muted-foreground">
            {fmt(shot.start)}–{fmt(shot.end)}s · uses {fmt(shot.targetSec)}s
          </span>
        </div>
      ))}
    </div>
  );
}
