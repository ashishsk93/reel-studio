import { z } from 'zod';
import { IMAGE_MODELS, OUTFIT_STATES, PRODUCT_IMAGE_ROLES, SCENE_TYPES, SHOT_KINDS } from '../enums.js';
import { hasPlaceholder } from './product.js';

export const StoryboardSceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  purpose: z.string().describe('What this shot does for the Reel, one sentence'),
  shotKind: z.enum(SHOT_KINDS).describe('Framing; decides which reference images are attached'),
  outfitState: z.enum(OUTFIT_STATES).describe('own_clothes = her home outfit; wearing_product = dressed in the product'),
  showsProduct: z.boolean(),
  setting: z.string().describe('Where, consistent across scenes that share a location'),
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
  motion: z.string().describe('Subtle motion for the later video step, e.g. "she slowly lifts the kurta and smiles"'),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardOutputSchema = z.object({
  scenes: z.array(StoryboardSceneSchema),
  notes: z.array(z.string()).describe('Short notes on choices, e.g. why a back view was skipped'),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutputSchema>;

export interface StoryboardConstraints {
  backKnown: boolean;
  pieceCount: number;
  availableRoles: string[];
  /** Total for the main scenes, excluding the CTA. */
  minTotalSec: number;
  maxTotalSec: number;
}

function wordCount(text: string): number {
  return text
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function sceneIssues(scene: StoryboardScene, c: StoryboardConstraints): string[] {
  const issues: string[] = [];
  if (scene.shotKind === 'back' && !c.backKnown) issues.push('back view used but the back of the product is unknown');
  if (scene.type === 'pieces' && c.pieceCount < 2) issues.push('"pieces" scene used but the product has one piece');
  if (hasPlaceholder(scene.description)) issues.push('description contains brackets or placeholders');
  const words = wordCount(scene.onScreenText);
  if (words < 2 || words > 8) issues.push(`on-screen text should be 3-7 words (got ${words})`);
  const unknownRoles = scene.productRoles.filter((r) => !c.availableRoles.includes(r));
  if (unknownRoles.length) issues.push(`productRoles not uploaded: ${unknownRoles.join(', ')}`);
  if (scene.targetDurationSec < 1 || scene.targetDurationSec > 5) issues.push('targetDurationSec must be 1-5');
  return issues;
}

/** Builds the checked schema for one project's constraints; issues become retry feedback. */
export function storyboardChecked(c: StoryboardConstraints) {
  return StoryboardOutputSchema.superRefine((out, ctx) => {
    if (out.scenes.length < 3 || out.scenes.length > 8) {
      ctx.addIssue({ code: 'custom', path: ['scenes'], message: `Use 3-8 scenes (got ${out.scenes.length})` });
    }
    out.scenes.forEach((scene, i) => {
      for (const message of sceneIssues(scene, c)) ctx.addIssue({ code: 'custom', path: ['scenes', i], message });
    });
    const total = out.scenes.reduce((sum, s) => sum + s.targetDurationSec, 0);
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
