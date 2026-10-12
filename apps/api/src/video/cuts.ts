import type { ExpectedShotDto, ShotBoundDto } from '@reel/shared';

/** Normalised videos are constant 30 fps, so times map to exact frames. */
export const FPS = 30;

export const toFrame = (t: number) => Math.round(t * FPS);
export const snap = (t: number) => Math.round(Math.round(t * FPS) / FPS * 1000) / 1000;

export interface SceneChange {
  t: number;
  score: number;
}

/** Scene-change candidates from `select='gt(scene,x)',metadata=print` stderr. */
export function parseSceneScores(stderr: string): SceneChange[] {
  const out: SceneChange[] = [];
  let t: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const time = /pts_time:\s*([0-9.]+)/.exec(line);
    if (time) t = Number(time[1]);
    const score = /scene_score=([0-9.]+)/.exec(line);
    if (score && t !== null) {
      out.push({ t, score: Number(score[1]) });
      t = null;
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

const MIN_SHOT = 0.3;

/**
 * Maps scene changes onto the planned shot boundaries. Each planned boundary (scaled to the
 * real duration) takes the nearest unused strong cut (score >= threshold) within `tolerance`,
 * else the strongest weaker change within half that; otherwise the scaled planned time is
 * used and the shot is marked unmatched so the user can drag it.
 */
export function mapCuts(
  expected: Array<Pick<ExpectedShotDto, 'sceneId' | 'start' | 'end'>>,
  changes: SceneChange[],
  durationSec: number,
  options: { threshold?: number; tolerance?: number } = {},
): Array<Pick<ShotBoundDto, 'sceneId' | 'start' | 'end' | 'matched'>> {
  if (expected.length === 0) return [];
  const threshold = options.threshold ?? 0.3;
  const tolerance = options.tolerance ?? 1;
  const plannedTotal = expected[expected.length - 1].end || durationSec;
  const scale = durationSec / plannedTotal;
  const boundaries: Array<{ t: number; matched: boolean }> = [{ t: 0, matched: true }];
  const used = new Set<number>();
  for (let i = 1; i < expected.length; i++) {
    const planned = expected[i].start * scale;
    const prev = boundaries[i - 1].t;
    const remaining = expected.length - i; // shots still to fit after this boundary
    const candidates = changes
      .map((c, idx) => ({ c, idx }))
      .filter(({ c, idx }) => !used.has(idx) && c.t > prev + MIN_SHOT && c.t < durationSec - remaining * MIN_SHOT);
    const strong = candidates
      .filter(({ c }) => c.score >= threshold && Math.abs(c.t - planned) <= tolerance)
      .sort((x, y) => Math.abs(x.c.t - planned) - Math.abs(y.c.t - planned))[0];
    const weak = candidates
      .filter(({ c }) => Math.abs(c.t - planned) <= tolerance / 2)
      .sort((x, y) => y.c.score - x.c.score)[0];
    const pick = strong ?? weak;
    if (pick) {
      used.add(pick.idx);
      boundaries.push({ t: snap(pick.c.t), matched: true });
    } else {
      const t = Math.min(Math.max(planned, prev + MIN_SHOT), durationSec - remaining * MIN_SHOT);
      boundaries.push({ t: snap(t), matched: false });
    }
  }
  return expected.map((shot, i) => ({
    sceneId: shot.sceneId,
    start: boundaries[i].t,
    end: i === expected.length - 1 ? snap(durationSec) : boundaries[i + 1].t,
    matched: boundaries[i].matched,
  }));
}

export interface WindowOptions {
  /** Skip the first frames after a cut (transition blur). */
  leadSec?: number;
  /** Kling shots tend to drift or morph in their last moments. */
  tailSec?: number;
  usableFrom?: number | null;
  usableTo?: number | null;
}

/**
 * The window of a shot used in the Reel: `targetSec` long, starting as early as possible
 * inside the clean part of the shot, never in its last ~0.3 s. Shorter shots give what they have.
 */
export function suggestWindow(bound: { start: number; end: number }, targetSec: number, options: WindowOptions = {}): { inSec: number; outSec: number } {
  const lead = options.leadSec ?? 0.1;
  const tail = options.tailSec ?? 0.3;
  let lo = Math.max(bound.start + lead, options.usableFrom ?? -Infinity);
  let hi = Math.min(bound.end - tail, options.usableTo ?? Infinity);
  if (hi - lo < 0.5) {
    lo = bound.start + lead;
    hi = bound.end - tail;
  }
  if (hi - lo < 0.5) {
    lo = bound.start;
    hi = bound.end;
  }
  const inSec = snap(lo);
  const outSec = snap(Math.min(hi, lo + targetSec));
  return { inSec, outSec: Math.max(outSec, snap(inSec + 1 / FPS)) };
}

/**
 * Frames sent to the video review: each shot's midpoint, frames either side of every detected
 * cut, the first and last frame, plus even 2 fps sampling capped at 24. Deduplicated and
 * snapped to real frames.
 */
export function planFrameTimes(
  durationSec: number,
  bounds: Array<{ start: number; end: number }>,
  cuts: number[],
  options: { fps?: number; cap?: number } = {},
): number[] {
  const last = Math.max(0, durationSec - 1 / FPS);
  const key = [
    0,
    last,
    ...bounds.map((b) => (b.start + b.end) / 2),
    ...cuts.flatMap((c) => [c - 0.15, c + 0.15]),
  ];
  const count = Math.min(options.cap ?? 24, Math.floor(durationSec * (options.fps ?? 2)));
  const sampled = Array.from({ length: count }, (_, i) => ((i + 0.5) * durationSec) / count);
  const out: number[] = [];
  for (const t of [...key, ...sampled].map((t) => snap(Math.min(last, Math.max(0, t))))) {
    if (!out.some((o) => Math.abs(o - t) < 0.1)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

export function shotIndexAt(bounds: Array<{ start: number; end: number }>, t: number): number {
  const i = bounds.findIndex((b) => t >= b.start && t < b.end);
  return i >= 0 ? i : bounds.length - 1;
}

/** Problems with hand-edited bounds, empty when valid. */
export function boundsIssues(
  bounds: Array<{ sceneId: string; start: number; end: number; inSec: number; outSec: number }>,
  sceneIds: string[],
  durationSec: number,
): string[] {
  const issues: string[] = [];
  if (bounds.map((b) => b.sceneId).join(',') !== sceneIds.join(',')) issues.push('Send one entry per shot, in order.');
  const eps = 0.02;
  bounds.forEach((b, i) => {
    const n = i + 1;
    if (b.end - b.start < MIN_SHOT - eps) issues.push(`Shot ${n} is shorter than ${MIN_SHOT}s.`);
    if (i === 0 && Math.abs(b.start) > eps) issues.push('The first shot must start at 0.');
    if (i > 0 && Math.abs(b.start - bounds[i - 1].end) > eps) issues.push(`Shot ${n} must start where shot ${i} ends.`);
    if (b.end > durationSec + eps) issues.push(`Shot ${n} ends after the video (${durationSec}s).`);
    if (b.inSec < b.start - eps || b.outSec > b.end + eps || b.outSec - b.inSec < 1 / FPS - eps) {
      issues.push(`Shot ${n}: the in/out window must lie inside the shot.`);
    }
  });
  return issues;
}
