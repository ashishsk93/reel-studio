"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LightboxItem {
  url: string;
  kind?: "image" | "video";
  label?: string;
}

interface LightboxApi {
  open: (items: LightboxItem[], index?: number) => void;
}

const LightboxContext = createContext<LightboxApi | null>(null);

const isVideo = (item: LightboxItem) => item.kind === "video" || /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(item.url);

/** One full-screen viewer for the whole app: images (click to zoom, drag-free pan) and videos. */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const open = useCallback((items: LightboxItem[], index = 0) => {
    if (items.length) setState({ items, index: Math.min(Math.max(index, 0), items.length - 1) });
  }, []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <LightboxContext.Provider value={api}>
      {children}
      {state && (
        <Viewer
          items={state.items}
          index={state.index}
          onIndex={(index) => setState({ ...state, index })}
          onClose={() => setState(null)}
        />
      )}
    </LightboxContext.Provider>
  );
}

export function useLightbox(): LightboxApi {
  const api = useContext(LightboxContext);
  if (!api) throw new Error("useLightbox must be used inside LightboxProvider");
  return api;
}

function Viewer({ items, index, onIndex, onClose }: { items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[index];
  const [zoom, setZoom] = useState<{ index: number; on: boolean }>({ index, on: false });
  const zoomed = zoom.on && zoom.index === index;
  const [origin, setOrigin] = useState("50% 50%");
  const many = items.length > 1;
  const go = useCallback((delta: number) => onIndex((index + delta + items.length) % items.length), [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) go(1);
      else if (e.key === "ArrowLeft" && many) go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [go, many, onClose]);

  const follow = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.label ?? "Full-screen view"}
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white"
      onClick={onClose}
    >
      <div className="flex items-center gap-3 px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-white/80">
          {item.label}
          {many && <span className="ml-2 text-white/50">{index + 1} / {items.length}</span>}
        </span>
        {!isVideo(item) && (
          <button
            type="button"
            className="rounded-md p-2 hover:bg-white/10"
            aria-label={zoomed ? "Zoom out" : "Zoom in"}
            onClick={() => setZoom({ index, on: !zoomed })}
          >
            {zoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          </button>
        )}
        <a href={item.url} download target="_blank" rel="noreferrer" className="rounded-md p-2 hover:bg-white/10" aria-label="Open original">
          <Download className="size-5" />
        </a>
        <button type="button" className="rounded-md p-2 hover:bg-white/10" aria-label="Close (Esc)" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-14 pb-6">
        {isVideo(item) ? (
          <video
            key={item.url}
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg bg-black"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.url}
            src={item.url}
            alt={item.label ?? ""}
            className={cn(
              "max-h-full max-w-full select-none rounded-lg object-contain transition-transform duration-150",
              zoomed ? "scale-[2.5] cursor-zoom-out" : "cursor-zoom-in",
            )}
            style={{ transformOrigin: origin }}
            onMouseMove={zoomed ? follow : undefined}
            onClick={(e) => {
              e.stopPropagation();
              follow(e);
              setZoom({ index, on: !zoomed });
            }}
            draggable={false}
          />
        )}
        {many && (
          <>
            <button
              type="button"
              aria-label="Previous"
              className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
              onClick={(e) => (e.stopPropagation(), go(-1))}
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Next"
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
              onClick={(e) => (e.stopPropagation(), go(1))}
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Makes its child open full screen on click. With `button`, the child keeps its own click
 * (e.g. selecting a version) and a small expand button appears on hover instead.
 */
export function Expandable({
  items,
  index = 0,
  button,
  className,
  children,
}: {
  items: LightboxItem[];
  index?: number;
  button?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { open } = useLightbox();
  if (button) {
    return (
      <div className={cn("group/expand relative", className)}>
        {children}
        <button
          type="button"
          aria-label="View full screen"
          title="View full screen"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            open(items, index);
          }}
          className="absolute top-1.5 right-1.5 z-10 rounded-md bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover/expand:opacity-100 focus-visible:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      title="View full screen"
      className={cn("cursor-zoom-in", className)}
      onClick={(e) => {
        e.stopPropagation();
        open(items, index);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") open(items, index);
      }}
    >
      {children}
    </div>
  );
}
