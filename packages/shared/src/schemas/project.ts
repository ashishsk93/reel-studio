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
