import { z } from 'zod';
import { CHECK_RESULTS, IMAGE_MODELS, ISSUE_SEVERITIES, VERDICTS } from '../enums.js';
import { hasPlaceholder } from './product.js';

/** Normalised box, origin top-left, all values 0–1. */
export const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Box = z.infer<typeof BoxSchema>;

export const CheckSchema = z.object({
  item: z.string().describe('What was checked, e.g. "Face match with the anchor"'),
  result: z.enum(CHECK_RESULTS),
  note: z.string().describe('Short and concrete; what is off when not a match'),
});

export const GarmentCheckSchema = z.object({
  key: z.string().describe('A must-match key, exactly as given'),
  result: z.enum(CHECK_RESULTS),
  note: z.string(),
});

export const ReviewIssueSchema = z.object({
  severity: z.enum(ISSUE_SEVERITIES),
  description: z.string(),
  region: BoxSchema.nullable().describe('Where the problem is, normalised; null if it is not in one place'),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

/**
 * One edit, as data. The app turns it into the paste-ready prompt: it numbers the images,
 * puts the image being edited first and appends the identity and persona rules.
 */
export const EditPlanSchema = z.object({
  title: z.string().describe('Short label, e.g. "Denser sleeve embroidery"'),
  instruction: z
    .string()
    .describe(
      'The change, as an instruction to an image editor, concrete and visual. Refer to images by what they show ("the product images", "her anchor reference"), never by number.',
    ),
  keep: z.string().describe('What must stay exactly the same, concretely: her face, hair, pose, expression, background, lighting, framing…'),
  attach: z
    .array(z.string())
    .describe('Keys of reference images to attach after the image being edited, most useful first. Only keys from the list given.'),
  tool: z.enum(IMAGE_MODELS),
  checkAfter: z.array(z.string()).describe('2-4 things to check in the edited image'),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const ImageReviewOutputSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string().describe('One or two sentences: the overall judgement and the main problem, if any'),
  identity: z.array(CheckSchema),
  garment: z.array(GarmentCheckSchema).describe('One entry per must-match key; empty when the product is not in frame or not relevant'),
  anatomy: z.array(CheckSchema),
  artefacts: z.array(CheckSchema),
  composition: z.array(CheckSchema),
  faceBox: BoxSchema.nullable().describe('Her face from forehead to chin, normalised; null if no face is visible'),
  issues: z.array(ReviewIssueSchema).describe('Concrete problems, most severe first'),
  fixes: z.array(EditPlanSchema).describe('1-3 edits for warn or fail, most important first; empty for pass'),
});
export type ImageReviewOutput = z.infer<typeof ImageReviewOutputSchema>;

export interface ReviewConstraints {
  /** Must-match keys that must each be scored (empty: no garment section required). */
  mustMatchKeys: string[];
  /** Reference keys the edit plans may attach. */
  attachKeys: string[];
}

const IMAGE_NUMBER = /\bimages?\s+\d/i;

export function editPlanIssues(plan: EditPlan, attachKeys: string[]): string[] {
  const issues: string[] = [];
  const unknown = plan.attach.filter((k) => !attachKeys.includes(k));
  if (unknown.length) issues.push(`attach keys not in the list: ${unknown.join(', ')}`);
  for (const field of ['instruction', 'keep'] as const) {
    if (!plan[field].trim()) issues.push(`${field} is empty`);
    if (hasPlaceholder(plan[field])) issues.push(`${field} contains brackets or placeholders`);
    if (IMAGE_NUMBER.test(plan[field])) issues.push(`${field} refers to images by number; the app numbers them`);
  }
  return issues;
}

/** Consistency checks the JSON schema can't express; failures go back to the model. */
export function imageReviewChecked(c: ReviewConstraints) {
  return ImageReviewOutputSchema.superRefine((out, ctx) => {
    if (out.identity.length === 0) ctx.addIssue({ code: 'custom', path: ['identity'], message: 'Score the identity checks' });
    if (c.mustMatchKeys.length) {
      const got = out.garment.map((g) => g.key);
      const missing = c.mustMatchKeys.filter((k) => !got.includes(k));
      const extra = got.filter((k) => !c.mustMatchKeys.includes(k));
      if (missing.length) ctx.addIssue({ code: 'custom', path: ['garment'], message: `Missing must-match keys: ${missing.join(', ')}` });
      if (extra.length) ctx.addIssue({ code: 'custom', path: ['garment'], message: `Unknown keys: ${extra.join(', ')}` });
    }
    const checks = [...out.identity, ...out.garment, ...out.anatomy, ...out.artefacts, ...out.composition];
    const serious = out.issues.filter((i) => i.severity !== 'minor');
    if (out.verdict === 'pass' && (checks.some((x) => x.result === 'mismatch') || serious.length)) {
      ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'A mismatch or a major/critical issue cannot be a pass' });
    }
    if (out.verdict !== 'fail' && out.issues.some((i) => i.severity === 'critical')) {
      ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'A critical issue means fail' });
    }
    if (out.verdict !== 'pass' && out.fixes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['fixes'], message: 'Give at least one fix for warn or fail' });
    }
    out.fixes.forEach((fix, i) => {
      for (const message of editPlanIssues(fix, c.attachKeys)) ctx.addIssue({ code: 'custom', path: ['fixes', i], message });
    });
    const boxes = [out.faceBox, ...out.issues.map((i) => i.region)].filter((b): b is Box => b !== null);
    if (boxes.some((b) => [b.x, b.y, b.w, b.h, b.x + b.w, b.y + b.h].some((v) => v < 0 || v > 1.001))) {
      ctx.addIssue({ code: 'custom', path: ['faceBox'], message: 'Boxes are normalised: every value and x+w, y+h within 0-1' });
    }
  });
}

// ---------- Modification assistant ----------

export const AssistantOutputSchema = z.object({
  reply: z.string().describe('1-3 sentences to the user'),
  edit: EditPlanSchema.nullable().describe('The edit; null only when the user asked a question that needs no edit'),
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export function assistantChecked(attachKeys: string[]) {
  return AssistantOutputSchema.superRefine((out, ctx) => {
    if (!out.edit) return;
    for (const message of editPlanIssues(out.edit, attachKeys)) ctx.addIssue({ code: 'custom', path: ['edit'], message });
  });
}

// ---------- Character creator ----------

export const CreatorPromptOutputSchema = z.object({
  prompt: z.string().describe('The complete rewritten prompt'),
});

/** `required` are sentences (identity, persona rules) that must survive the rewrite verbatim. */
export function creatorPromptChecked(required: string[]) {
  return CreatorPromptOutputSchema.superRefine((out, ctx) => {
    if (hasPlaceholder(out.prompt)) ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'No brackets or placeholders' });
    const lost = required.filter((r) => r.trim() && !out.prompt.includes(r.trim()));
    if (lost.length) {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: `Keep these sentences verbatim: ${lost.map((l) => `"${l}"`).join(' ')}` });
    }
  });
}
