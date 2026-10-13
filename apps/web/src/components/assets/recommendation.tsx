"use client";

import { Star } from "lucide-react";
import type { VersionPickDto } from "@reel/shared";

/** "Recommended: v3 · Jev, 82% confident" under the version strip, with a button to view it. */
export function RecommendationNote({ pick, onSelect }: { pick: VersionPickDto; onSelect: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Star className="size-3.5 fill-amber-400 text-amber-400" />
      <span>
        Recommended:{" "}
        <button type="button" className="font-semibold text-foreground underline-offset-2 hover:underline" onClick={onSelect}>
          version {pick.version}
        </button>
      </span>
      <span>
        ·{" "}
        {pick.by === "jev"
          ? `Jev, ${Math.round((pick.confidence ?? 0) * 100)}% confident`
          : "from the review verdicts"}
      </span>
      {pick.by === "jev" && <span>· {pick.note}</span>}
    </p>
  );
}

/** Small star on the recommended version's thumbnail. */
export function RecommendedStar() {
  return <Star className="absolute right-0.5 bottom-0.5 size-3.5 fill-amber-400 text-amber-400 drop-shadow" aria-label="Recommended" />;
}
