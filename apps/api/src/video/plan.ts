import type { ExpectedShotDto } from '@reel/shared';

export interface PlanScene {
  id: string;
  order: number;
  setting: string;
  outfitState: string;
  targetDurationSec: number;
  onScreenText: string;
}

export interface PlannedJob {
  sceneIds: string[];
  durationSec: number;
  expectedShots: ExpectedShotDto[];
}

export interface PlanOptions {
  maxSec: number;
  minSec: number;
  /** Generated beyond each scene's target, so the best window can be picked. */
  paddingSec: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Seconds generated for a scene: target plus padding, rounded up to half a second. */
export function shotLength(targetSec: number, paddingSec: number, maxSec: number): number {
  return Math.min(maxSec, Math.ceil((targetSec + paddingSec) * 2) / 2);
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

/** The location part of a setting: the text before the first comma or semicolon. */
function location(setting: string): string {
  return setting.split(/[,;]| - /)[0].trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Same place, same outfit state: the storyboard often adds shot details to the setting
 * ("…bedroom with fairy lights, the pants laid flat on the bed"), so compare the location
 * clause, or fall back to word overlap.
 */
export function sameSetup(a: Pick<PlanScene, 'setting' | 'outfitState'>, b: Pick<PlanScene, 'setting' | 'outfitState'>): boolean {
  if (a.outfitState !== b.outfitState) return false;
  if (location(a.setting) && location(a.setting) === location(b.setting)) return true;
  const wa = words(a.setting);
  const wb = words(b.setting);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.max(1, new Set([...wa, ...wb]).size) >= 0.6;
}

function job(scenes: PlanScene[], lengths: number[], options: PlanOptions, fixedSec?: number): PlannedJob {
  const total = lengths.reduce((a, b) => a + b, 0);
  const durationSec = Math.min(options.maxSec, Math.max(options.minSec, fixedSec ?? 0, Math.ceil(total - 1e-9)));
  // Spare seconds (rounding up to Kling's whole-second durations) go to the last shot.
  const shots = [...lengths];
  shots[shots.length - 1] += Math.max(0, durationSec - total);
  let start = 0;
  const expectedShots = scenes.map((scene, i) => {
    const end = i === scenes.length - 1 ? durationSec : round1(start + shots[i]);
    const shot: ExpectedShotDto = {
      sceneId: scene.id,
      sceneOrder: scene.order,
      start: round1(start),
      end,
      targetSec: scene.targetDurationSec,
      text: scene.onScreenText,
    };
    start = end;
    return shot;
  });
  return { sceneIds: scenes.map((s) => s.id), durationSec, expectedShots };
}

/**
 * Multi-shot mode: consecutive scenes that share a setting and outfit state go into one Kling
 * run (one start image works for all of them), split whenever a run would exceed maxSec.
 */
export function planMultiShot(scenes: PlanScene[], options: PlanOptions): PlannedJob[] {
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const groups: PlanScene[][] = [];
  let used = 0;
  for (const scene of sorted) {
    const length = shotLength(scene.targetDurationSec, options.paddingSec, options.maxSec);
    const current = groups[groups.length - 1];
    if (current && sameSetup(current[0], scene) && used + length <= options.maxSec) {
      current.push(scene);
      used += length;
    } else {
      groups.push([scene]);
      used = length;
    }
  }
  return groups.map((group) =>
    job(
      group,
      group.map((s) => shotLength(s.targetDurationSec, options.paddingSec, options.maxSec)),
      options,
    ),
  );
}

/** Single-scene mode: one image-to-video generation per scene, from that scene's approved still. */
export function planSingle(scenes: PlanScene[], options: PlanOptions): PlannedJob[] {
  return [...scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene) => job([scene], [shotLength(scene.targetDurationSec, options.paddingSec, options.maxSec)], options));
}

export function creditEstimate(durationSec: number, creditsPer5s: number): number {
  return Math.round((durationSec / 5) * creditsPer5s * 100) / 100;
}
