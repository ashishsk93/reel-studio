"use client";

import type { ReactNode } from "react";
import { ImageOff, TriangleAlert } from "lucide-react";
import type { PromptCardDto } from "@reel/shared";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/** Copy-ready prompt with its ordered attachments. */
export function PromptCard({
  card,
  title,
  chips,
  footer,
  compact,
}: {
  card: PromptCardDto;
  title?: ReactNode;
  chips?: ReactNode;
  footer?: ReactNode;
  /** Smaller thumbnails and prompt box, for fixes and assistant answers. */
  compact?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" data-copy-target>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {chips}
        </div>
        <CopyButton text={card.prompt} label="Copy prompt" size={compact ? "sm" : "lg"} />
      </div>

      <pre
        className={cn(
          "overflow-auto bg-muted/40 px-4 py-3 font-mono leading-relaxed whitespace-pre-wrap",
          compact ? "max-h-48 text-xs" : "max-h-80 text-[13px]",
        )}
      >
        {card.prompt}
      </pre>

      <div className="border-t px-4 py-3">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Attach in this order</p>
        <ol className="flex flex-wrap gap-3">
          {card.attachments.map((a) => (
            <li key={`${a.index}-${a.id}`} className={compact ? "w-16" : "w-28"}>
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg border bg-muted">
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.label} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-5" />
                  </div>
                )}
                <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {a.index}
                </span>
              </div>
              <p className="mt-1 truncate text-xs" title={a.label}>
                {a.label}
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground" title={a.fileName}>
                {a.fileName}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {(card.missing.length > 0 || card.notes.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t px-4 py-3 text-xs">
          {card.missing.map((m) => (
            <p key={m} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-3.5" /> {m}
            </p>
          ))}
          {card.notes.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}

      {footer && <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-3">{footer}</div>}
    </div>
  );
}
