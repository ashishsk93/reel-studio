import { z } from 'zod';
import {
  IMAGE_MODELS,
  OUTFIT_STATES,
  PRICE_MODES,
  PRODUCT_IMAGE_ROLES,
  PROJECT_STATUSES,
  SCENE_TYPES,
  SHOT_KINDS,
} from '../enums.js';

/** Blank clears the field (null). */
const optionalUrl = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(z.url('Must be a full URL starting with https://').nullable())
  .nullable()
  .optional();

export const ProjectFieldsSchema = z.object({
  influencerId: z.string().min(1, 'Pick an influencer'),
  sourceId: z.string().min(1, 'Pick a source'),
  productTitle: z.string().trim().min(1, 'Required'),
  priceInr: z.coerce.number().int('Whole rupees').positive('Enter the price'),
  priceModeOverride: z.enum(PRICE_MODES).nullable().optional(),
  productUrl: optionalUrl,
  affiliateLink: optionalUrl,
  occasion: z.string().trim().min(1, 'Required, e.g. "Diwali party"'),
});
export type ProjectFields = z.input<typeof ProjectFieldsSchema>;

/** Multipart create: the fields plus a JSON array of roles, one per uploaded file. */
export const ProjectCreateFieldsSchema = ProjectFieldsSchema.extend({
  roles: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return [];
      try {
        return z.array(z.enum(PRODUCT_IMAGE_ROLES)).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: 'custom', message: `roles must be a JSON array of: ${PRODUCT_IMAGE_ROLES.join(', ')}` });
        return z.NEVER;
      }
    }),
});

export const ProjectUpdateSchema = ProjectFieldsSchema.partial();
export type ProjectUpdate = z.output<typeof ProjectUpdateSchema>;

export const ProjectGotoSchema = z.object({ status: z.enum(PROJECT_STATUSES) });

export const ProductImageUpdateSchema = z.object({
  role: z.enum(PRODUCT_IMAGE_ROLES).optional(),
});

export const ProductImagesUploadFieldsSchema = z.object({
  roles: ProjectCreateFieldsSchema.shape.roles,
});

export const IdOrderSchema = z.object({ ids: z.array(z.string()).min(1) });

export const InstructionSchema = z.object({
  instruction: z.string().trim().max(2000).optional(),
});
export type Instruction = z.infer<typeof InstructionSchema>;

// ---------- Scenes ----------

export const SceneEditableSchema = z.object({
  type: z.enum(SCENE_TYPES),
  purpose: z.string().trim().min(1),
  shotKind: z.enum(SHOT_KINDS),
  outfitState: z.enum(OUTFIT_STATES),
  showsProduct: z.boolean(),
  setting: z.string().trim(),
  description: z.string().trim().min(1, 'Describe the scene'),
  productRoles: z.array(z.enum(PRODUCT_IMAGE_ROLES)),
  onScreenText: z.string().trim(),
  targetDurationSec: z.number().min(0.5).max(15),
  imageModel: z.enum(IMAGE_MODELS),
  imageModelReason: z.string().trim(),
  motion: z.string().trim(),
});
export type SceneEditable = z.infer<typeof SceneEditableSchema>;

export const SceneUpdateSchema = SceneEditableSchema.partial().extend({
  /** A hand-edited prompt; set `promptOverride: false` to rebuild it from the fields. */
  imagePrompt: z.string().trim().min(1).optional(),
  promptOverride: z.boolean().optional(),
});
export type SceneUpdate = z.infer<typeof SceneUpdateSchema>;

export const SceneCreateSchema = SceneEditableSchema.extend({
  afterSceneId: z.string().optional(),
});
export type SceneCreate = z.infer<typeof SceneCreateSchema>;

export const StoryboardGenerateSchema = InstructionSchema.extend({
  /** Required when existing scenes already have uploads. */
  force: z.boolean().optional(),
});
