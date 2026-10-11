import { PROJECT_STATUSES, type ProjectStatus } from './enums.js';

/** The 8 workflow steps shown in the project stepper. */
export const STEPS = [
  { key: 'product', label: 'Product', requires: 'draft', completes: 'draft' },
  { key: 'analysis', label: 'Analysis', requires: 'draft', completes: 'product_analyzed' },
  { key: 'storyboard', label: 'Storyboard', requires: 'product_analyzed', completes: 'storyboard_ready' },
  { key: 'images', label: 'Images', requires: 'storyboard_ready', completes: 'images_approved' },
  { key: 'video-prompts', label: 'Video prompts', requires: 'images_approved', completes: 'video_prompts_ready' },
  { key: 'videos', label: 'Videos', requires: 'video_prompts_ready', completes: 'videos_approved' },
  { key: 'compose', label: 'Compose', requires: 'videos_approved', completes: 'composed' },
  { key: 'export', label: 'Export', requires: 'composed', completes: 'rendered' },
] as const satisfies ReadonlyArray<{ key: string; label: string; requires: ProjectStatus; completes: ProjectStatus }>;

export type StepKey = (typeof STEPS)[number]['key'];

export function statusIndex(status: ProjectStatus): number {
  return PROJECT_STATUSES.indexOf(status);
}

export function isStatusAtLeast(status: ProjectStatus, target: ProjectStatus): boolean {
  return statusIndex(status) >= statusIndex(target);
}

/** A step can be opened once the furthest status ever reached satisfies its requirement. */
export function canOpenStep(step: StepKey, furthest: ProjectStatus): boolean {
  const def = STEPS.find((s) => s.key === step)!;
  return isStatusAtLeast(furthest, def.requires);
}

export function isStepDone(step: StepKey, furthest: ProjectStatus): boolean {
  const def = STEPS.find((s) => s.key === step)!;
  return step === 'product' ? true : isStatusAtLeast(furthest, def.completes);
}

/** Moving forward records the new furthest status; going back never loses it. */
export function advance(
  current: { status: ProjectStatus; furthestStatus: ProjectStatus },
  to: ProjectStatus,
): { status: ProjectStatus; furthestStatus: ProjectStatus } {
  return {
    status: to,
    furthestStatus: isStatusAtLeast(current.furthestStatus, to) ? current.furthestStatus : to,
  };
}
