"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Box, ComposeSegmentDto, ComposeStepDto } from "@reel/shared";
import { cn } from "@/lib/utils";

const W = 1080;
const H = 1920;

/**
 * 9:16 preview of one segment exactly as rendered: the window of its video looping (scaled to
 * cover, centre-cropped), the text overlay PNG and the badge PNG at its placement. The badge
 * can be dragged; dropping calls onMoveBadge with output-pixel coordinates.
 */
export function ReelPreview({
  segment,
  step,
  width = 320,
  showZones,
  showDetections,
  onMoveBadge,
}: {
  segment: ComposeSegmentDto;
  step: ComposeStepDto;
  width?: number;
  showZones: boolean;
  showDetections: boolean;
  onMoveBadge: (pos: { x: number; y: number; scale: number }) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const k = width / W;
  const placement = segment.placement;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Loop the segment's window.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const start = () => {
      v.currentTime = segment.inSec;
      void v.play().catch(() => undefined);
    };
    const tick = () => {
      if (v.currentTime >= segment.outSec || v.currentTime < segment.inSec - 0.1) v.currentTime = segment.inSec;
    };
    v.addEventListener("loadedmetadata", start);
    v.addEventListener("timeupdate", tick);
    if (v.readyState >= 1) start();
    return () => {
      v.removeEventListener("loadedmetadata", start);
      v.removeEventListener("timeupdate", tick);
    };
  }, [segment.inSec, segment.outSec, segment.videoUrl]);

  const badge = segment.badge && segment.badgeEnabled && placement ? segment.badge : null;
  const pos = drag ?? (placement ? { x: placement.x, y: placement.y } : null);

  const down = (e: ReactPointerEvent) => {
    if (!pos) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };
  const move = (e: ReactPointerEvent) => {
    const s = dragStart.current;
    if (!s || !badge || !placement) return;
    const bw = badge.w * placement.scale;
    const bh = badge.h * placement.scale;
    setDrag({
      x: Math.round(Math.min(Math.max(0, s.x + (e.clientX - s.px) / k), W - bw)),
      y: Math.round(Math.min(Math.max(0, s.y + (e.clientY - s.py) / k), H - bh)),
    });
  };
  const up = () => {
    if (dragStart.current && drag && placement) onMoveBadge({ ...drag, scale: placement.scale });
    dragStart.current = null;
    setDrag(null);
  };

  const boxStyle = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
  const z = step.safeZone;

  return (
    <div ref={frame} className="relative overflow-hidden rounded-2xl border bg-black select-none" style={{ width, height: (width * H) / W }}>
      <video ref={video} src={segment.videoUrl} muted playsInline className="absolute inset-0 size-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={segment.textOverlayUrl} alt="" className="pointer-events-none absolute inset-0 size-full" />
      {showZones && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/45" style={{ height: `${z.top * 100}%` }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${z.bottom * 100}%` }} />
          <div
            className="pointer-events-none absolute right-0 bg-black/45"
            style={{ top: "50%", bottom: `${z.bottom * 100}%`, width: `${z.rightLower * 100}%` }}
          />
        </>
      )}
      {showDetections && (
        <>
          {segment.detections.faces.map((b, i) => (
            <div key={`f${i}`} className="pointer-events-none absolute border-2 border-red-500" style={boxStyle(b)} />
          ))}
          {segment.detections.hands.map((b, i) => (
            <div key={`h${i}`} className="pointer-events-none absolute border-2 border-amber-400" style={boxStyle(b)} />
          ))}
          {segment.detections.persons.map((b, i) => (
            <div key={`p${i}`} className="pointer-events-none absolute border border-dashed border-sky-400" style={boxStyle(b)} />
          ))}
          {segment.detections.details.map((b, i) => (
            <div key={`d${i}`} className="pointer-events-none absolute border-2 border-fuchsia-500" style={boxStyle(b)} />
          ))}
          {segment.textBox && <div className="pointer-events-none absolute border border-white/70" style={boxStyle(segment.textBox)} />}
        </>
      )}
      {badge && pos && placement && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={badge.url}
          alt="Store badge"
          draggable={false}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={cn("absolute cursor-grab touch-none active:cursor-grabbing", segment.placementWarning && "ring-2 ring-amber-400")}
          style={{ left: pos.x * k, top: pos.y * k, width: badge.w * placement.scale * k, height: badge.h * placement.scale * k }}
        />
      )}
    </div>
  );
}
