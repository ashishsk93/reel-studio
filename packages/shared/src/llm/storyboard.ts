import { z } from 'zod';
import { IMAGE_MODELS, OUTFIT_STATES, PRODUCT_IMAGE_ROLES, SCENE_TYPES, SHOT_KINDS, type StoryFormat } from '../enums.js';
import { FORMATS, hasSegment } from '../formats.js';
import { hasPlaceholder } from './product.js';

export const StoryboardSceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  purpose: z.string().describe('What this shot does for the Reel, one sentence'),
  shotKind: z.enum(SHOT_KINDS).describe('Framing; decides which reference images are attached'),
  outfitState: z.enum(OUTFIT_STATES).describe('own_clothes = her home outfit; wearing_product = dressed in the product'),
  showsProduct: z.boolean(),
  product: z
    .number()
    .int()
    .nullable()
    .describe('Number of the product this scene shows or she wears (from the numbered product list), or null when she shows none (a hook in her own clothes)'),
  setting: z.string().describe('Where, consistent across scenes that share a location'),
  place: z
    .number()
    .int()
    .nullable()
    .describe("Number of her place (from the list of her places) this scene is set in, or null if none fits; its photo is attached as the background"),
  description: z
    .string()
    .describe(
      'The scene sentence(s) pasted into the image prompt: what she does, pose, framing, camera angle and position, setting details. Concrete and visual. No brackets, no placeholders, no product description (added separately).',
    ),
  productRoles: z
    .array(z.enum(PRODUCT_IMAGE_ROLES))
    .describe('Product images that matter for this shot, most relevant first. Only roles that exist.'),
  onScreenText: z.string().describe('3-7 words in her voice, factual; one emoji allowed'),
  targetDurationSec: z.number(),
  imageModel: z.enum(IMAGE_MODELS),
  imageModelReason: z.string().describe('One line'),
  motion: z
    .string()
    .describe('Subtle motion and her expression for the later video step, e.g. "she slowly lifts the kurta, smiling softly at the camera"'),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardOutputSchema = z.object({
  scenes: z.array(StoryboardSceneSchema),
  notes: z.array(z.string()).describe('Short notes on choices, e.g. why a back view was skipped'),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutputSchema>;

export interface ProductConstraints {
  backKnown: boolean;
  pieceCount: number;
  availableRoles: string[];
}

export interface StoryboardConstraints {
  format: StoryFormat;
  /** One entry per product, in product order (scene.product is 1-based). */
  products: ProductConstraints[];
  /** Total for the Reel's segments, excluding the CTA (transition "before" stills don't count). */
  minTotalSec: number;
  maxTotalSec: number;
  /** How many background places the influencer has (scene.place is 1..placeCount or null). */
  placeCount: number;
}

export function wordCount(text: string): number {
  return text
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function sceneIssues(scene: StoryboardScene, c: StoryboardConstraints): string[] {
  const issues: string[] = [];
  const rule = FORMATS[c.format];
  if (!rule.sceneTypes.includes(scene.type)) issues.push(`scene type "${scene.type}" is not used in this format; use ${rule.sceneTypes.join(', ')}`);
  const needsProduct = scene.showsProduct || scene.outfitState === 'wearing_product';
  if (scene.product !== null && (scene.product < 1 || scene.product > c.products.length)) {
    issues.push(`product must be 1-${c.products.length} or null`);
  } else if (needsProduct && scene.product === null) {
    issues.push('this scene shows or wears a product: set product to its number');
  }
  const product = scene.product ? c.products[scene.product - 1] : undefined;
  if (product) {
    if (scene.shotKind === 'back' && !product.backKnown) issues.push(`back view used but the back of product ${scene.product} is unknown`);
    if (scene.type === 'pieces' && product.pieceCount < 2) issues.push(`"pieces" scene used but product ${scene.product} has one piece`);
    const unknownRoles = scene.productRoles.filter((r) => !product.availableRoles.includes(r));
    if (unknownRoles.length) issues.push(`productRoles not uploaded for product ${scene.product}: ${unknownRoles.join(', ')}`);
  } else if (scene.productRoles.length && scene.product === null) {
    issues.push('productRoles must be empty when the scene shows no product');
  }
  if (hasPlaceholder(scene.description)) issues.push('description contains brackets or placeholders');
  const words = wordCount(scene.onScreenText);
  if (scene.type !== 'transition_before' && (words < 2 || words > 8)) issues.push(`on-screen text should be 3-7 words (got ${words})`);
  if (scene.targetDurationSec < 1 || scene.targetDurationSec > 5) issues.push('targetDurationSec must be 1-5');
  if (scene.place !== null && (scene.place < 1 || scene.place > c.placeCount)) {
    issues.push(c.placeCount ? `place must be 1-${c.placeCount} or null` : 'place must be null: she has no places yet');
  }
  return issues;
}

/** Order and count rules of each format (docs/formats.md); empty when the plan fits. */
export function formatIssues(scenes: Array<Pick<StoryboardScene, 'type' | 'product'>>, c: Pick<StoryboardConstraints, 'format' | 'products'>): string[] {
  const issues: string[] = [];
  const n = c.products.length;
  const count = (type: string) => scenes.filter((s) => s.type === type).length;
  const perProduct = (type: string) => {
    for (let k = 1; k <= n; k++) {
      const m = scenes.filter((s) => s.type === type && s.product === k).length;
      if (m !== 1) issues.push(`Use exactly one "${type}" scene for product ${k} (got ${m})`);
    }
  };
  const hooks = count('hook');
  switch (c.format) {
    case 'classic':
      if (scenes.length < 3 || scenes.length > 8) issues.push(`Use 3-8 scenes (got ${scenes.length})`);
      break;
    case 'haul':
    case 'occasion':
      if (hooks !== 1 || scenes[0]?.type !== 'hook') issues.push('Start with exactly one "hook" scene');
      perProduct('try_on');
      break;
    case 'transition':
      if (hooks > 1 || (hooks === 1 && scenes[0]?.type !== 'hook')) issues.push('At most one "hook", and only as the first scene');
      perProduct('transition_before');
      perProduct('transition_after');
      scenes.forEach((s, i) => {
        if (s.type === 'transition_before') {
          const next = scenes[i + 1];
          if (next?.type !== 'transition_after' || next.product !== s.product) {
            issues.push(`Scene ${i + 1} ("transition_before") must be followed by the "transition_after" of the same product`);
          }
        }
      });
      break;
    case 'three_ways':
      if (hooks !== 1 || scenes[0]?.type !== 'hook') issues.push('Start with exactly one "hook" scene');
      if (count('styled') !== 3) issues.push(`Use exactly three "styled" scenes (got ${count('styled')})`);
      break;
  }
  return issues;
}

/** Seconds the scenes add to the Reel (a transition's "before" still is only a start frame). */
export function segmentSeconds(scenes: Array<Pick<StoryboardScene, 'type' | 'targetDurationSec'>>): number {
  return Math.round(scenes.filter((s) => hasSegment(s.type)).reduce((sum, s) => sum + s.targetDurationSec, 0) * 10) / 10;
}

/** Builds the checked schema for one project's constraints; issues become retry feedback. */
export function storyboardChecked(c: StoryboardConstraints) {
  return StoryboardOutputSchema.superRefine((out, ctx) => {
    for (const message of formatIssues(out.scenes, c)) ctx.addIssue({ code: 'custom', path: ['scenes'], message });
    if (out.scenes.length > 12) ctx.addIssue({ code: 'custom', path: ['scenes'], message: `Use at most 12 scenes (got ${out.scenes.length})` });
    out.scenes.forEach((scene, i) => {
      for (const message of sceneIssues(scene, c)) ctx.addIssue({ code: 'custom', path: ['scenes', i], message });
    });
    const total = segmentSeconds(out.scenes);
    if (total < c.minTotalSec || total > c.maxTotalSec) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: `Scene durations add up to ${total}s; keep the total between ${c.minTotalSec} and ${c.maxTotalSec}s`,
      });
    }
  });
}

/** Single-scene rewrite ("Regenerate prompt" with an instruction). */
export const SceneReviseOutputSchema = z.object({ scene: StoryboardSceneSchema });

export function sceneReviseChecked(c: StoryboardConstraints) {
  return SceneReviseOutputSchema.superRefine((out, ctx) => {
    for (const message of sceneIssues(out.scene, c)) ctx.addIssue({ code: 'custom', path: ['scene'], message });
  });
}
