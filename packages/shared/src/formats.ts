import type { SceneType, StoryFormat } from './enums.js';

export interface FormatRule {
  label: string;
  /** One line for the project-creation picker. */
  description: string;
  /** Example headline, shown as the title placeholder. */
  titleExample: string;
  products: { min: number; max: number };
  /** Whole Reel including the CTA end card. */
  reelSec: { min: number; max: number };
  /** Scene types the storyboard may use. */
  sceneTypes: readonly SceneType[];
}

/** Story formats (docs/formats.md). */
export const FORMATS: Record<StoryFormat, FormatRule> = {
  classic: {
    label: 'Classic',
    description: 'One product: unboxing, hold up, details, then wearing it.',
    titleExample: 'Lavender net kurta set',
    products: { min: 1, max: 1 },
    reelSec: { min: 16, max: 20 },
    sceneTypes: ['unboxing', 'hold_up', 'pieces', 'detail', 'wearing_front', 'wearing_alt', 'custom'],
  },
  haul: {
    label: 'Price-cap haul',
    description: '2–5 products under one price: a quick try-on of each with its price on screen.',
    titleExample: 'Kurtis under ₹499',
    products: { min: 2, max: 5 },
    reelSec: { min: 10, max: 20 },
    sceneTypes: ['hook', 'try_on'],
  },
  occasion: {
    label: 'Occasion edit',
    description: '2–5 looks for one occasion: a quick try-on of each with its price on screen.',
    titleExample: '3 Diwali looks',
    products: { min: 2, max: 5 },
    reelSec: { min: 10, max: 20 },
    sceneTypes: ['hook', 'try_on'],
  },
  transition: {
    label: 'Outfit transition',
    description: '1–3 products: her own clothes, a quick move, and she is wearing it (Kling start and end frames).',
    titleExample: 'Comfy to festive in one spin',
    products: { min: 1, max: 3 },
    reelSec: { min: 10, max: 20 },
    sceneTypes: ['hook', 'transition_before', 'transition_after'],
  },
  three_ways: {
    label: 'One piece, 3 ways',
    description: 'One product styled for three occasions.',
    titleExample: '1 kurti, 3 ways',
    products: { min: 1, max: 1 },
    reelSec: { min: 14, max: 20 },
    sceneTypes: ['hook', 'styled'],
  },
};

/** Scene types that become their own Reel segment (a transition's "before" is only a start frame). */
export function hasSegment(type: SceneType): boolean {
  return type !== 'transition_before';
}

