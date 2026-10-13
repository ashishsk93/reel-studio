"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import type { ExpectedShotDto, ShotBoundDto, VideoAssetDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VERDICT_STYLE } from "@/components/assets/review-card";
import { API_URL, ApiError, api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Expandable } from "@/components/lightbox";

const FPS = 30;
const MIN_SHOT = 0.3;
const FRAME = 1 / FPS;
const snap = (t: number) => Math.round(Math.round(t * FPS) / FPS * 1000) / 1000;
const fmt = (t: number) => t.toFixed(2);

type Drag = { shot: number; kind: "boundary" | "in" | "out" | "move"; offset?: number };

/** Applies one drag to the bounds, keeping shots contiguous and windows inside their shot. */
export function applyDrag(bounds: ShotBoundDto[], drag: Drag, raw: number, duration: number): ShotBoundDto[] {
  const next = bounds.map((b) => ({ ...b }));
  const t = snap(raw);
  const cur = next[drag.shot];
  if (drag.kind === "boundary") {
    const prev = next[drag.shot - 1];
    const at = Math.min(Math.max(t, prev.start + MIN_SHOT), cur.end - MIN_SHOT);
    prev.end = at;
    cur.start = at;
    prev.outSec = Math.min(prev.outSec, at);
    prev.inSec = Math.min(prev.inSec, snap(prev.outSec - FRAME));
    cur.inSec = Math.max(cur.inSec, at);
    cur.outSec = Math.max(cur.outSec, snap(cur.inSec + FRAME));
  } else if (drag.kind === "in") {
    cur.inSec = Math.min(Math.max(t, cur.start), snap(cur.outSec - FRAME));
  } else if (drag.kind === "out") {
    cur.outSec = Math.max(Math.min(t, cur.end), snap(cur.inSec + FRAME));
  } else {
    const length = cur.outSec - cur.inSec;
    const start = Math.min(Math.max(snap(t - (drag.offset ?? 0)), cur.start), snap(cur.end - length));
    cur.inSec = start;
    cur.outSec = snap(start + length);
  }
  next[next.length - 1].end = Math.min(next[next.length - 1].end, duration);
  return next;
}

/**
 * Player + timeline for one uploaded video: drag shot boundaries (cuts) and each shot's in/out
 * window; the exact frame under the active handle comes from the server.
 */
export function TimelineEditor({
  asset,
  expected,
  sceneLabel,
  videoRef,
  onSaved,
}: {
  asset: VideoAssetDto;
  expected: ExpectedShotDto[];
  sceneLabel: (sceneId: string) => string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSaved: () => void | Promise<unknown>;
}) {
  const duration = asset.durationSec;
  const original = asset.shotBounds ?? [];
  const [bounds, setBounds] = useState<ShotBoundDto[]>(original);
  const [baseline, setBaseline] = useState(JSON.stringify(original));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const stopAt = useRef<number | null>(null);

  // Server data changed (review finished, saved elsewhere): take it unless there are unsaved edits.
  const incoming = JSON.stringify(original);
  if (incoming !== baseline) {
    const dirtyNow = JSON.stringify(bounds) !== baseline;
    setBaseline(incoming);
    if (!dirtyNow) setBounds(original);
  }
  const dirty = JSON.stringify(bounds) !== baseline;

  // Smooth playhead while playing; stop at the window end when playing a window.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        if (stopAt.current !== null && v.currentTime >= stopAt.current) {
          v.pause();
          stopAt.current = null;
        }
        setTime(v.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, videoRef]);

  // Exact frame for the handle being dragged, debounced.
  useEffect(() => {
    if (preview === null) return;
    const id = setTimeout(() => setPreviewSrc(`${API_URL}/assets/${asset.id}/frame?t=${preview.toFixed(3)}`), 120);
    return () => clearTimeout(id);
  }, [preview, asset.id]);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const at = Math.min(Math.max(0, t), Math.max(0, duration - FRAME));
      if (v) {
        v.pause();
        v.currentTime = at;
      }
      setTime(at);
    },
    [videoRef, duration],
  );

  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(Math.max(0, ((clientX - rect.left) / rect.width) * duration), duration);
  };

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (d.kind === "move") d.offset = timeAt(e.clientX) - bounds[d.shot].inSec;
    drag.current = d;
    setSelected(d.shot);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = applyDrag(bounds, d, timeAt(e.clientX), duration);
    setBounds(next);
    const b = next[d.shot];
    const t = d.kind === "boundary" ? b.start : d.kind === "out" ? Math.max(b.inSec, b.outSec - FRAME) : b.inSec;
    seek(t);
    setPreview(t);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      stopAt.current = null;
      void v.play();
    } else v.pause();
  };
  const playWindow = (i: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = bounds[i].inSec;
    stopAt.current = bounds[i].outSec;
    void v.play();
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/assets/${asset.id}/shot-bounds`, {
        bounds: bounds.map(({ sceneId, start, end, inSec, outSec }) => ({ sceneId, start, end, inSec, outSec })),
      }),
    onSuccess: async () => {
      toast.success("Timeline saved");
      setBaseline(JSON.stringify(bounds));
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.issues?.length ? e.issues.map((i) => i.message).join(" ") : errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/assets/${asset.id}/shot-bounds/reset`),
    onSuccess: async () => {
      toast.success("Back to the suggested timeline");
      await onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const reviewShots = asset.review?.shots ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <Expandable items={[{ url: asset.url, kind: "video", label: `Version ${asset.version}` }]} button>
        <video
          ref={videoRef}
          src={asset.normalizedUrl ?? asset.url}
          className="max-h-[56vh] w-auto max-w-[280px] rounded-xl border bg-black"
          playsInline
          muted
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            setTime(videoRef.current?.currentTime ?? 0);
          }}
          onSeeked={() => setTime(videoRef.current?.currentTime ?? 0)}
        />
        </Expandable>
        <div className="flex min-w-48 flex-1 flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Exact frame{preview !== null && ` at ${fmt(preview)} s (frame ${Math.round(preview * FPS)})`}</p>
          {previewSrc ? (
            <Expandable items={[{ url: previewSrc, label: "Exact frame" }]}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSrc} alt="Exact frame" className="max-h-[40vh] w-auto max-w-[220px] rounded-lg border bg-black" />
            </Expandable>
          ) : (
            <p className="max-w-56 text-xs text-muted-foreground">Drag a cut or an in/out handle to see the exact frame it lands on.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Previous frame" onClick={() => seek(time - FRAME)}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Next frame" onClick={() => seek(time + FRAME)}>
          <ChevronRight />
        </Button>
        <span className="font-mono text-xs tabular-nums">
          {fmt(time)} / {fmt(duration)} s · frame {Math.round(time * FPS)}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
            <RotateCcw /> Reset to suggestion
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save timeline
          </Button>
        </div>
      </div>

      {/* Track */}
      <div
        ref={track}
        className="relative h-24 touch-none rounded-lg border bg-muted/40 select-none"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={(e) => {
          if (e.target === track.current) seek(timeAt(e.clientX));
        }}
      >
        {/* planned shots (thin, top) */}
        {expected.map((s, i) => (
          <div
            key={`plan-${s.sceneId}`}
            className={cn("pointer-events-none absolute top-0 h-1.5", i % 2 ? "bg-foreground/25" : "bg-foreground/10")}
            style={{ left: pct(Math.min(s.start, duration)), width: pct(Math.max(0, Math.min(s.end, duration) - Math.min(s.start, duration))) }}
            title={`Planned shot ${i + 1}`}
          />
        ))}
        {bounds.map((b, i) => {
          const verdict = reviewShots[i]?.verdict;
          return (
            <div
              key={b.sceneId}
              className={cn("absolute top-2 bottom-0 border-r border-border/60", i % 2 ? "bg-primary/[0.06]" : "bg-primary/[0.12]")}
              style={{ left: pct(b.start), width: pct(b.end - b.start) }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  setSelected(i);
                  seek(timeAt(e.clientX));
                }
              }}
            >
              <span className="pointer-events-none absolute top-1 left-1.5 flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap">
                {verdict && <span className={cn("size-2 rounded-full", VERDICT_STYLE[verdict].dot)} />}
                {i + 1}. {sceneLabel(b.sceneId)}
              </span>
            </div>
          );
        })}
        {/* windows */}
        {bounds.map((b, i) => (
          <div
            key={`w-${b.sceneId}`}
            className={cn(
              "absolute bottom-2 h-8 cursor-grab rounded border-2 bg-primary/30 active:cursor-grabbing",
              i === selected ? "border-primary" : "border-primary/50",
            )}
            style={{ left: pct(b.inSec), width: pct(b.outSec - b.inSec) }}
            onPointerDown={(e) => startDrag(e, { shot: i, kind: "move" })}
            title={`Used in the Reel: ${fmt(b.inSec)}–${fmt(b.outSec)} s`}
          >
            <span
              className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize rounded-l bg-primary"
              onPointerDown={(e) => startDrag(e, { shot: i, kind: "in" })}
            />
            <span
              className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize rounded-r bg-primary"
              onPointerDown={(e) => startDrag(e, { shot: i, kind: "out" })}
            />
          </div>
        ))}
        {/* cut handles */}
        {bounds.slice(1).map((b, j) => (
          <div
            key={`cut-${b.sceneId}`}
            className="absolute top-0 bottom-0 z-10 -ml-1.5 flex w-3 cursor-col-resize justify-center"
            style={{ left: pct(b.start) }}
            onPointerDown={(e) => startDrag(e, { shot: j + 1, kind: "boundary" })}
            title={b.matched ? "Detected cut (drag to adjust)" : "No cut detected here: drag to where the shot changes"}
          >
            <span className={cn("w-0.5", b.matched ? "bg-foreground/70" : "border-l-2 border-dashed border-amber-500")} />
          </div>
        ))}
        {/* detected cuts */}
        {(asset.cuts ?? []).map((c) => (
          <span key={c} className="pointer-events-none absolute bottom-0 h-1.5 w-0.5 bg-destructive" style={{ left: pct(c) }} title={`Detected cut ${fmt(c)} s`} />
        ))}
        {/* playhead */}
        <span className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-foreground" style={{ left: pct(time) }} />
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">
        Grey bar: planned shots. Red ticks: detected cuts. Drag a cut line to move a shot boundary (dashed = no cut found); drag the pink
        window or its edges to choose what goes in the Reel.
      </p>

      <ul className="flex flex-col gap-1.5">
        {bounds.map((b, i) => {
          const target = expected[i]?.targetSec;
          const length = b.outSec - b.inSec;
          const s = reviewShots[i];
          return (
            <li
              key={b.sceneId}
              className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs", i === selected && "border-primary/60 bg-primary/5")}
            >
              <button type="button" className="font-semibold" onClick={() => setSelected(i)}>
                Shot {i + 1} · {sceneLabel(b.sceneId)}
              </button>
              <span className="font-mono tabular-nums">
                {fmt(b.inSec)}–{fmt(b.outSec)} s ({fmt(length)} s{target ? ` of ${target} s` : ""})
              </span>
              {target && length < target - 0.05 && <Badge variant="outline" className="text-amber-600">Shorter than planned</Badge>}
              {!b.matched && i > 0 && <Badge variant="outline">Cut not detected</Badge>}
              {b.manual && <Badge variant="secondary">Edited</Badge>}
              {s && (
                <span className="text-muted-foreground">
                  suggested {fmt(s.suggestedIn)}–{fmt(s.suggestedOut)} s
                </span>
              )}
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => playWindow(i)}>
                <Play /> Play window
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
