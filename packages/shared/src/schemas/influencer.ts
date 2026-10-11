import { z } from 'zod';
import { INFLUENCER_STATUSES, REF_TAGS } from '../enums.js';

const text = z.string().trim();
const required = text.min(1, 'Required');

export const ConditionalFeatureSchema = z.object({
  feature: required,
  rule: required,
});
export type ConditionalFeature = z.infer<typeof ConditionalFeatureSchema>;

export const InfluencerFieldsSchema = z.object({
  name: required,
  age: z.number().int().min(18, 'Must be an adult').max(80),
  city: required,
  identityBlock: required,
  shortIdentity: required,
  voiceNotes: text,
  exampleLines: z.array(required),
  personality: text,
  lane: text,
  hashtag: z.string().trim().regex(/^#\w+$/, 'One hashtag, e.g. #AanyaPicks'),
  signatureDetails: z.array(required),
  forbiddenFeatures: z.array(required),
  conditionalFeatures: z.array(ConditionalFeatureSchema),
  defaultStyling: text,
  homeOutfit: text,
  homeSetting: text,
});
export type InfluencerFields = z.infer<typeof InfluencerFieldsSchema>;

export const SlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes');

export const InfluencerCreateSchema = InfluencerFieldsSchema.extend({
  slug: SlugSchema.optional(),
  status: z.enum(INFLUENCER_STATUSES).default('active'),
});
export type InfluencerCreate = z.input<typeof InfluencerCreateSchema>;

export const InfluencerUpdateSchema = InfluencerFieldsSchema.partial().extend({
  slug: SlugSchema.optional(),
  status: z.enum(INFLUENCER_STATUSES).optional(),
});
export type InfluencerUpdate = z.infer<typeof InfluencerUpdateSchema>;

export const RefTagsSchema = z.array(z.enum(REF_TAGS));

export const ReferenceImageUpdateSchema = z.object({
  tags: RefTagsSchema.optional(),
  note: z.string().optional(),
  sortOrder: z.number().int().optional(),
});
export type ReferenceImageUpdate = z.infer<typeof ReferenceImageUpdateSchema>;

/** Multipart fields arrive as strings; tags are a JSON array or comma-separated list. */
export const ReferenceUploadFieldsSchema = z.object({
  tags: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return [];
      let raw: unknown;
      try {
        raw = value.trim().startsWith('[') ? JSON.parse(value) : value.split(',').map((t) => t.trim()).filter(Boolean);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'tags must be a JSON array or comma-separated list' });
        return z.NEVER;
      }
      const parsed = RefTagsSchema.safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `Unknown tag. Allowed: ${REF_TAGS.join(', ')}` });
        return z.NEVER;
      }
      return parsed.data;
    }),
  note: z.string().optional().default(''),
});

// ---------- Character creator ----------

export const CreatorBriefSchema = z.object({
  name: z.string().trim().optional(),
  age: z.number().int().min(18, 'Must be an adult').max(80),
  city: required,
  lane: required,
  vibe: required,
  lookNotes: text.default(''),
  voiceLanguage: required,
  mustHave: text.default(''),
  mustAvoid: text.default(''),
});
export type CreatorBrief = z.input<typeof CreatorBriefSchema>;

export const PersonaRegenerateSchema = z.object({
  instruction: z.string().trim().optional(),
});
export type PersonaRegenerate = z.infer<typeof PersonaRegenerateSchema>;
