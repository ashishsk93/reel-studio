import { z } from 'zod';
import { TRANSPARENCY } from '../enums.js';

/**
 * Structured garment description. Field descriptions double as instructions for the model,
 * so they say what "good" looks like. Kept free of length constraints (JSON-schema subset);
 * extra checks live in ProductAnalysisChecked.
 */
export const ProductSpecSchema = z.object({
  category: z.string().describe('e.g. "kurta set", "co-ord set", "dress", "saree", "lehenga"'),
  garmentType: z.string().describe('Specific type, e.g. "front-slit A-line kurta with straight pants"'),
  pieces: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .describe('Every piece in the set, e.g. kurta, pants, dupatta. One entry for a single garment.'),
  colours: z.object({
    exactColourName: z.string().describe('Precise colour name a buyer would use, e.g. "soft lavender-lilac"'),
    primary: z.string(),
    secondary: z.array(z.string()),
    sheen: z.string().describe('matte, satin sheen, metallic zari, sequin sparkle, or "none"'),
  }),
  fabric: z.object({
    material: z.string().describe('What it looks like, e.g. "net", "georgette", "cotton"; say "appears to be" when unsure'),
    transparency: z.enum(TRANSPARENCY),
    lined: z.string().describe('"lined", "unlined" or "unknown"'),
    notes: z.string(),
  }),
  neckline: z.object({ front: z.string(), back: z.string().describe('"unknown" if no back image') }),
  sleeves: z.string(),
  fitSilhouette: z.string(),
  length: z.string().describe('With body reference points, e.g. "ankle-length", "mid-calf", "hip-length"'),
  openings: z.array(z.string()).describe('Slits and openings with position'),
  closures: z.array(z.string()),
  waistDetails: z.string(),
  surfaceWork: z.object({
    type: z.string().describe('embroidery, print, beadwork, sequins, mirror work, or "none"'),
    pattern: z.string(),
    density: z.string().describe('e.g. "dense all-over", "sparse buttis", "border only"'),
    motifs: z.string(),
    placement: z.string(),
  }),
  hemDetails: z.string(),
  backDetails: z.string().describe('"unknown" if no back image'),
  otherDistinctive: z.array(z.string()),
  listingStyling: z.object({
    jewellery: z.string(),
    footwear: z.string(),
    other: z.string(),
  }),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

export const MustMatchItemSchema = z.object({
  key: z.string().describe('short snake_case id, e.g. "embroidery_density"'),
  label: z.string().describe('What to check, e.g. "Embroidery density"'),
  expected: z.string().describe('What correct looks like, concretely'),
});
export type MustMatchItem = z.infer<typeof MustMatchItemSchema>;

export const ProductAnalysisOutputSchema = z.object({
  spec: ProductSpecSchema,
  mustMatch: z
    .array(MustMatchItemSchema)
    .describe('6-10 attributes most likely to be got wrong by an image generator or noticed by a buyer'),
  unknowns: z
    .array(z.string())
    .describe('Attributes that cannot be seen in the images, e.g. "back neckline and back details (no back image)"'),
  garmentParagraph: z
    .string()
    .describe('One paste-ready paragraph describing the outfit for an image prompt. Ends with "Exact colour: …".'),
});
export type ProductAnalysisOutput = z.infer<typeof ProductAnalysisOutputSchema>;

const PLACEHOLDER = /\[[^\]]*\]|\{\{|\}\}|\bTODO\b|\bTBD\b/;

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/** Checks the JSON schema can't express; failures go back to the model as retry feedback. */
export const ProductAnalysisChecked = ProductAnalysisOutputSchema.superRefine((out, ctx) => {
  if (out.mustMatch.length < 6 || out.mustMatch.length > 10) {
    ctx.addIssue({ code: 'custom', path: ['mustMatch'], message: `Give 6-10 items (got ${out.mustMatch.length})` });
  }
  if (out.spec.pieces.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['spec', 'pieces'], message: 'List at least one piece' });
  }
  if (hasPlaceholder(out.garmentParagraph)) {
    ctx.addIssue({ code: 'custom', path: ['garmentParagraph'], message: 'No brackets or placeholders' });
  }
  if (!/Exact colou?r:/i.test(out.garmentParagraph)) {
    ctx.addIssue({ code: 'custom', path: ['garmentParagraph'], message: 'End with "Exact colour: …"' });
  }
});

export const GarmentParagraphOutputSchema = z.object({
  garmentParagraph: z.string(),
});

export const GarmentParagraphChecked = GarmentParagraphOutputSchema.superRefine((out, ctx) => {
  if (hasPlaceholder(out.garmentParagraph)) {
    ctx.addIssue({ code: 'custom', path: ['garmentParagraph'], message: 'No brackets or placeholders' });
  }
  if (!/Exact colou?r:/i.test(out.garmentParagraph)) {
    ctx.addIssue({ code: 'custom', path: ['garmentParagraph'], message: 'End with "Exact colour: …"' });
  }
});

/** PUT body for manual edits on the analysis page. */
export const ProductSpecSaveSchema = z.object({
  spec: ProductSpecSchema,
  mustMatch: z.array(MustMatchItemSchema.extend({ label: z.string().trim().min(1), expected: z.string().trim().min(1) })),
  unknowns: z.array(z.string().trim().min(1)),
  garmentParagraph: z.string().trim().min(1),
});
export type ProductSpecSave = z.infer<typeof ProductSpecSaveSchema>;
