import { z } from 'zod';
import {
  VIDEO_MODES,
  IMAGE_MODELS,
  OUTFIT_STATES,
  PRICE_MODES,
  PRODUCT_IMAGE_ROLES,
  PROJECT_STATUSES,
  SCENE_TYPES,
  SHOT_KINDS,
  STORY_FORMATS,
} from '../enums.js';
import { FORMATS } from '../formats.js';

/** Blank clears the field (null). */
const optionalUrl = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(z.url('Must be a full URL starting with https://').nullable())
  .nullable()
  .optional();

/** One product of a project: what the badge, captions and DM need. */
export const ProductFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Required'),
  sourceId: z.string().min(1, 'Pick a store'),
  priceInr: z.coerce.number().int('Whole rupees').positive('Enter the price'),
  priceModeOverride: z.enum(PRICE_MODES).nullable().optional(),
  productUrl: optionalUrl,
  affiliateLink: optionalUrl,
  note: z.string().trim().max(60, 'Keep it short: it is shown on screen').default(''),
});
export type ProductFields = z.input<typeof ProductFieldsSchema>;

export const ProductUpdateSchema = ProductFieldsSchema.partial();
export type ProductUpdate = z.output<typeof ProductUpdateSchema>;

export const ProjectFieldsSchema = z.object({
  influencerId: z.string().min(1, 'Pick an influencer'),
  format: z.enum(STORY_FORMATS).default('classic'),
  title: z.string().trim().min(1, 'Required'),
  occasion: z.string().trim().min(1, 'Required, e.g. "Diwali party"'),
  /** Off: no scene gets on-screen text. */
  showText: z.boolean().default(true),
});
export type ProjectFields = z.input<typeof ProjectFieldsSchema>;

/** A JSON-encoded multipart field. */
const jsonField = <T extends z.ZodType>(schema: T, what: string) =>
  z.string().transform((value, ctx): z.output<T> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${what} must be JSON` });
      return z.NEVER;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return result.data;
  });

const rolesField = z
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
  });

/**
 * Multipart create: the project fields, `products` (JSON array, each with `imageCount`), and the
 * `images` files in product order with `roles` (JSON array, one per file).
 */
export const ProjectCreateFieldsSchema = ProjectFieldsSchema.extend({
  showText: z.stringbool().default(true),
  products: jsonField(z.array(ProductFieldsSchema.extend({ imageCount: z.number().int().min(1, 'Add at least one photo') })).min(1), 'products'),
  roles: rolesField,
}).superRefine((data, ctx) => {
  const rule = FORMATS[data.format];
  const n = data.products.length;
  if (n < rule.products.min || n > rule.products.max) {
    const range = rule.products.min === rule.products.max ? `${rule.products.min}` : `${rule.products.min}–${rule.products.max}`;
    ctx.addIssue({ code: 'custom', path: ['products'], message: `${rule.label} takes ${range} product${rule.products.max > 1 ? 's' : ''} (got ${n})` });
  }
});

/** Multipart add-product: the product fields plus its photos and their `roles`. */
export const ProductCreateFieldsSchema = ProductFieldsSchema.extend({ roles: rolesField });

/** No defaults here: a partial update must never reset the format to classic or turn text back on. */
export const ProjectUpdateSchema = ProjectFieldsSchema.extend({ format: z.enum(STORY_FORMATS), showText: z.boolean() }).partial();
export type ProjectUpdate = z.output<typeof ProjectUpdateSchema>;

export const ProjectGotoSchema = z.object({ status: z.enum(PROJECT_STATUSES) });

export const ProductImageUpdateSchema = z.object({
  role: z.enum(PRODUCT_IMAGE_ROLES).optional(),
});

export const ProductImagesUploadFieldsSchema = z.object({
  roles: rolesField,
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
  /** One of the influencer's background references (her room), attached so the setting stays the same. */
  backgroundId: z.string().nullable().default(null),
  /** The product this scene shows; null for a hook that shows none. */
  productId: z.string().nullable().default(null),
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

// ---------- Step 4 ----------

export const AssistantMessageCreateSchema = z.object({
  message: z.string().trim().min(1, 'Describe the change').max(2000),
});

// ---------- Steps 5–6 ----------

export const VideoModeSchema = z.object({ mode: z.enum(VIDEO_MODES) });

export const VideoJobsGenerateSchema = z.object({
  /** Required when the jobs being replaced already have uploads. */
  force: z.boolean().optional(),
});

export const VideoJobUpdateSchema = z.object({
  /** A hand-edited prompt; `promptOverride: false` rebuilds it from the template. */
  prompt: z.string().trim().min(1).optional(),
  promptOverride: z.boolean().optional(),
});
export type VideoJobUpdate = z.infer<typeof VideoJobUpdateSchema>;

export const ShotBoundsUpdateSchema = z.object({
  bounds: z
    .array(
      z.object({
        sceneId: z.string(),
        start: z.number().min(0),
        end: z.number().positive(),
        inSec: z.number().min(0),
        outSec: z.number().positive(),
      }),
    )
    .min(1),
});
export type ShotBoundsUpdate = z.infer<typeof ShotBoundsUpdateSchema>;

// ---------- Steps 7–8 ----------

const NormBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const SegmentComposeUpdateSchema = z.object({
  onScreenText: z.string().trim().max(120).optional(),
  badgeEnabled: z.boolean().optional(),
  /** A dragged badge (output pixels); null returns it to automatic placement. */
  badgePlacement: z.object({ x: z.number(), y: z.number(), scale: z.number().min(0.4).max(1.5) }).nullable().optional(),
});
export type SegmentComposeUpdate = z.infer<typeof SegmentComposeUpdateSchema>;

/** MediaPipe results from the browser, normalised to the source video frame. */
export const SegmentDetectionsSchema = z.object({
  faces: z.array(NormBox),
  hands: z.array(NormBox),
  persons: z.array(NormBox),
});
export type SegmentDetections = z.infer<typeof SegmentDetectionsSchema>;

export const CtaUpdateSchema = z.object({
  text: z.string().trim().min(1).max(120).optional(),
  durationSec: z.number().min(2).max(4).optional(),
  background: z.enum(['last_frame', 'chosen_frame']).optional(),
  frame: z.object({ segmentId: z.string(), timeSec: z.number().min(0) }).nullable().optional(),
  zoom: z.boolean().optional(),
  darken: z.number().min(0).max(0.8).optional(),
});
export type CtaUpdate = z.infer<typeof CtaUpdateSchema>;

export const CoverChooseSchema = z.object({
  candidate: z.number().int().min(0),
  title: z.string().trim().min(1).max(60),
});

export const CaptionsUpdateSchema = z.object({
  caption: z.string().optional(),
  hashtags: z.array(z.string().trim().min(2)).optional(),
  firstComment: z.string().nullable().optional(),
  dmTemplate: z.string().optional(),
  checklist: z.array(z.object({ item: z.string().trim().min(1), done: z.boolean() })).optional(),
});
export type CaptionsUpdate = z.infer<typeof CaptionsUpdateSchema>;
