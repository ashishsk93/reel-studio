import type { Box } from '@reel/shared';

export const FRAME_W = 1080;
export const FRAME_H = 1920;

export const BADGE_ANCHORS = ['top-left', 'top-right', 'mid-left', 'mid-right', 'lower-left', 'lower-right'] as const;
export type BadgeAnchor = (typeof BADGE_ANCHORS)[number];

export interface SafeZone {
  top: number;
  bottom: number;
  rightLower: number;
  marginPx: number;
}

/** Boxes are normalised to the output frame (0–1). */
export interface Detections {
  faces: Box[];
  hands: Box[];
  persons: Box[];
  details: Box[];
}

export interface PlacementInput {
  badge: { w: number; h: number };
  detections: Detections;
  textBox: Box | null;
  zone: SafeZone;
  /** Anchor used by the previous badge segment, preferred for consistency. */
  previous?: BadgeAnchor | null;
}

export interface Placement {
  anchor: BadgeAnchor;
  /** Top-left corner in output pixels. */
  x: number;
  y: number;
  scale: number;
  /** Weighted overlap; 0 is a clean placement. */
  overlapScore: number;
  /** Set when every position overlaps something it shouldn't. */
  warning: string | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const toPx = (b: Box): Rect => ({ x: b.x * FRAME_W, y: b.y * FRAME_H, w: b.w * FRAME_W, h: b.h * FRAME_H });

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Fraction of the badge covered by the union of the boxes (sampled on a grid, so the same
 * face found on five frames counts once).
 */
function overlap(badge: Rect, boxes: Box[]): number {
  if (boxes.length === 0) return 0;
  const rects = boxes.map(toPx).filter((r) => intersection(badge, r) > 0);
  if (rects.length === 0) return 0;
  const nx = 24;
  const ny = 12;
  let hit = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = badge.x + ((i + 0.5) / nx) * badge.w;
      const y = badge.y + ((j + 0.5) / ny) * badge.h;
      if (rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) hit++;
    }
  }
  return hit / (nx * ny);
}

/** Regions Instagram covers: the top band, the bottom band and the action buttons on the lower right. */
export function blockedRegions(zone: SafeZone): Rect[] {
  return [
    { x: 0, y: 0, w: FRAME_W, h: zone.top * FRAME_H },
    { x: 0, y: (1 - zone.bottom) * FRAME_H, w: FRAME_W, h: zone.bottom * FRAME_H },
    { x: (1 - zone.rightLower) * FRAME_W, y: FRAME_H / 2, w: zone.rightLower * FRAME_W, h: FRAME_H / 2 },
  ];
}

/** Candidate positions, each already inside the safe zone. */
export function candidates(badge: { w: number; h: number }, zone: SafeZone): Record<BadgeAnchor, Rect> {
  const m = zone.marginPx;
  const top = zone.top * FRAME_H + m;
  const lower = (1 - zone.bottom) * FRAME_H - m - badge.h;
  const right = FRAME_W - m - badge.w;
  const lowerRight = (1 - zone.rightLower) * FRAME_W - m - badge.w;
  const mid = FRAME_H / 2 - badge.h - m / 2; // just above the middle, clear of the lower-right buttons
  return {
    'top-left': { x: m, y: top, w: badge.w, h: badge.h },
    'top-right': { x: right, y: top, w: badge.w, h: badge.h },
    'mid-left': { x: m, y: FRAME_H * 0.58, w: badge.w, h: badge.h },
    'mid-right': { x: right, y: mid, w: badge.w, h: badge.h },
    'lower-left': { x: m, y: lower, w: badge.w, h: badge.h },
    'lower-right': { x: lowerRight, y: lower, w: badge.w, h: badge.h },
  };
}

/** Small tie-breaker: corners near the top read first, lower corners compete with the caption. */
const PREFERENCE: Record<BadgeAnchor, number> = {
  'top-right': 0,
  'top-left': 0.01,
  'lower-left': 0.02,
  'lower-right': 0.03,
  'mid-left': 0.04,
  'mid-right': 0.05,
};

interface Scored {
  anchor: BadgeAnchor;
  rect: Rect;
  hard: number;
  soft: number;
  /** Hands + garment detail coverage: what a clean placement must avoid. */
  avoid: number;
}

function score(anchor: BadgeAnchor, rect: Rect, input: PlacementInput): Scored {
  const { detections: d } = input;
  const blocked = blockedRegions(input.zone).reduce((s, r) => s + intersection(rect, r), 0) / (rect.w * rect.h);
  const offFrame = rect.x < 0 || rect.y < 0 || rect.x + rect.w > FRAME_W || rect.y + rect.h > FRAME_H ? 1 : 0;
  const hard = overlap(rect, d.faces) + (input.textBox ? overlap(rect, [input.textBox]) : 0) + blocked + offFrame;
  const avoid = overlap(rect, d.hands) + overlap(rect, d.details);
  const soft = 5 * avoid + overlap(rect, d.persons) + PREFERENCE[anchor] + (input.previous && input.previous !== anchor ? 0.15 : 0);
  return { anchor, rect, hard, soft, avoid };
}

function pick(input: PlacementInput, scale: number): Scored[] {
  const badge = { w: input.badge.w * scale, h: input.badge.h * scale };
  const rects = candidates(badge, input.zone);
  return BADGE_ANCHORS.map((a) => score(a, rects[a], input)).sort((a, b) => a.hard - b.hard || a.soft - b.soft);
}

/**
 * Section 7 of the brief: faces and the on-screen text are hard rejects; hands and garment
 * details are heavily penalised, the person box lightly; the previous segment's corner is
 * preferred. If nothing is clean, retry at 80 % size, then take the least-overlapping spot
 * and warn.
 */
export function placeBadge(input: PlacementInput): Placement {
  for (const scale of [1, 0.8]) {
    const best = pick(input, scale)[0];
    if (best.hard === 0 && best.avoid < 0.1) {
      return { anchor: best.anchor, x: Math.round(best.rect.x), y: Math.round(best.rect.y), scale, overlapScore: round(best.soft), warning: null };
    }
  }
  const fallback = pick(input, 0.8).sort((a, b) => 10 * a.hard + a.soft - (10 * b.hard + b.soft))[0];
  const what = fallback.hard > 0 ? 'her face or the on-screen text' : 'her hands, the garment detail or her body';
  return {
    anchor: fallback.anchor,
    x: Math.round(fallback.rect.x),
    y: Math.round(fallback.rect.y),
    scale: 0.8,
    overlapScore: round(10 * fallback.hard + fallback.soft),
    warning: `Every badge position overlaps ${what}; using the least-overlapping one (${fallback.anchor}). Drag it or turn the badge off.`,
  };
}

/** Overlap score of a hand-placed badge, so a manual position still gets a warning when it covers something. */
export function checkManual(input: PlacementInput, x: number, y: number, scale: number): { overlapScore: number; warning: string | null } {
  const rect = { x, y, w: input.badge.w * scale, h: input.badge.h * scale };
  const s = score('top-left', rect, { ...input, previous: null });
  const hard = s.hard > 0.001;
  return {
    overlapScore: round(10 * s.hard + s.soft - PREFERENCE['top-left']),
    warning: hard ? 'The badge covers her face, the on-screen text or an area Instagram hides.' : s.avoid >= 0.1 ? 'The badge covers her hands or the garment detail.' : null,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Maps a box normalised to the source video into the 1080×1920 output after "scale to cover,
 * centre crop" (identity for 9:16 sources).
 */
export function sourceToOutput(box: Box, srcW: number, srcH: number): Box | null {
  const scale = Math.max(FRAME_W / srcW, FRAME_H / srcH);
  const offX = (srcW * scale - FRAME_W) / 2;
  const offY = (srcH * scale - FRAME_H) / 2;
  const x1 = (box.x * srcW * scale - offX) / FRAME_W;
  const y1 = (box.y * srcH * scale - offY) / FRAME_H;
  const x2 = ((box.x + box.w) * srcW * scale - offX) / FRAME_W;
  const y2 = ((box.y + box.h) * srcH * scale - offY) / FRAME_H;
  const cx1 = Math.max(0, x1);
  const cy1 = Math.max(0, y1);
  const cx2 = Math.min(1, x2);
  const cy2 = Math.min(1, y2);
  if (cx2 <= cx1 || cy2 <= cy1) return null;
  return { x: round(cx1), y: round(cy1), w: round(cx2 - cx1), h: round(cy2 - cy1) };
}
