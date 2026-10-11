import { z } from 'zod';

/**
 * Structured output for the character creator's persona step.
 * Kept free of length/range constraints so it maps cleanly onto the API's JSON-schema subset;
 * stricter checks run afterwards through InfluencerFieldsSchema.
 */
export const PersonaOutputSchema = z.object({
  name: z.string().describe('First and last name, e.g. "Aanya Kapoor"'),
  age: z.number().int().describe('Adult age in years'),
  city: z.string(),
  identityBlock: z
    .string()
    .describe('One paragraph used verbatim in image prompts: age, ethnicity, skin, face, eyes, brows, nose, lips, hair, jewellery, build and height, signature makeup, expression. Ends with "An original person, not a celebrity or real individual."'),
  shortIdentity: z.string().describe('Compressed identity for "Keep X identical: ..." sentences, under 45 words'),
  signatureDetails: z.array(z.string()),
  forbiddenFeatures: z.array(z.string()).describe('Features that must never appear, phrased as rules, e.g. "no nose ring or nose piercing"'),
  conditionalFeatures: z
    .array(z.object({ feature: z.string(), rule: z.string() }))
    .describe('Features that appear only under a visibility condition'),
  voiceNotes: z.string(),
  exampleLines: z.array(z.string()).describe('3-5 short example hooks in her voice'),
  personality: z.string(),
  lane: z.string().describe('Content niche, occasions and festivals'),
  hashtag: z.string().describe('Personal hashtag, e.g. #AanyaPicks'),
  defaultStyling: z.string(),
  homeOutfit: z.string().describe('Casual outfit for unboxing scenes'),
  homeSetting: z.string().describe('Her bedroom or home setting for indoor scenes'),
});
export type PersonaOutput = z.infer<typeof PersonaOutputSchema>;
