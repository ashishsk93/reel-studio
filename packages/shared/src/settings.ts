import { z } from 'zod';
import { EFFORT_LEVELS, IMAGE_MODELS, LLM_TASKS, REF_TAGS, SCENE_TYPES } from './enums.js';

/** USD per 1M tokens. */
export const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

const refTags = z.array(z.enum(REF_TAGS));

export const SETTINGS = {
  'llm.prices': {
    label: 'Model prices (USD per 1M tokens)',
    schema: z.record(z.string(), ModelPriceSchema),
    default: {
      'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
      'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
    },
  },
  'llm.usdToInr': {
    label: 'USD → INR rate for cost display',
    schema: z.number().positive(),
    default: 88,
  },
  'llm.effort': {
    label: 'Thinking effort per task',
    schema: z.object({
      default: z.enum(EFFORT_LEVELS),
      tasks: z.partialRecord(z.enum(LLM_TASKS), z.enum(EFFORT_LEVELS)),
    }),
    default: { default: 'medium' as const, tasks: {} },
  },
  'tools.image': {
    label: 'Image tools (Higgsfield)',
    schema: z.record(
      z.enum(IMAGE_MODELS),
      z.object({ label: z.string(), maxRefs: z.number().int().min(1), notes: z.string() }),
    ),
    default: {
      gpt_image: { label: 'GPT Image', maxRefs: 4, notes: 'Strong at following detailed edit instructions.' },
      nano_banana: { label: 'Nano Banana', maxRefs: 4, notes: 'Strong at keeping faces consistent across references.' },
    },
  },
  'tools.video': {
    label: 'Video tool (Kling 3.0 on Higgsfield)',
    schema: z.object({
      label: z.string(),
      maxElementRefs: z.number().int().min(0),
      maxMultiShotSec: z.number().positive(),
      singleShotSec: z.number().positive(),
      resolution: z.string(),
      sound: z.boolean(),
      creditsPer5s: z.number().nonnegative(),
      /** Shortest generation Kling accepts. */
      minSec: z.number().positive().default(3),
      /** Extra seconds generated per shot beyond the scene's target, so there is room to trim. */
      shotPaddingSec: z.number().min(0).max(3).default(0.5),
    }),
    default: {
      label: 'Kling 3.0',
      maxElementRefs: 4,
      maxMultiShotSec: 15,
      singleShotSec: 5,
      resolution: '720p',
      sound: false,
      creditsPer5s: 6.25,
      minSec: 3,
      shotPaddingSec: 0.5,
    },
  },
  'storyboard.refRules': {
    label: 'Reference image selection rules',
    schema: z.object({
      alwaysFirst: refTags,
      fullBody: refTags,
      fullBodyHairUp: refTags,
      hairUpKeywords: z.array(z.string()),
      threeQuarter: refTags,
      medium: refTags,
      backView: refTags,
      closeUp: refTags,
      backProductImageOnlyForBackView: z.boolean(),
    }),
    default: {
      alwaysFirst: ['anchor'] as const,
      fullBody: ['base_front'] as const,
      fullBodyHairUp: ['base_hair_up'] as const,
      hairUpKeywords: ['halter', 'saree', 'backless'],
      threeQuarter: ['base_three_quarter'] as const,
      medium: [] as const,
      backView: ['turnaround'] as const,
      closeUp: [] as const,
      backProductImageOnlyForBackView: true,
    },
  },
  'video.multiShotTemplate': {
    label: 'Kling multi-shot prompt template',
    schema: z.object({
      shotLine: z.string(),
      cutMarker: z.string(),
      footer: z.string(),
    }),
    default: {
      shotLine: 'Shot {{index}} ({{start}}–{{end}}s): {{description}} {{motion}}',
      cutMarker: 'Hard cut.',
      footer:
        "Static, locked-off camera in every shot. {{name}}'s face and hair stay identical across all shots{{forbiddenReminder}}. The outfit stays exactly the same in every frame: same colour, pattern, neckline, length and cut. Subtle, realistic motion only, photorealistic, no text, no captions.",
    },
  },
  'media.sceneThreshold': {
    label: 'Scene-cut detection threshold (0–1)',
    schema: z.number().min(0).max(1),
    default: 0.3,
  },
  'overlay.safeZone': {
    label: 'Instagram safe zone (fractions of the frame)',
    schema: z.object({
      top: z.number().min(0).max(0.5),
      bottom: z.number().min(0).max(0.5),
      rightLower: z.number().min(0).max(0.5),
      marginPx: z.number().int().min(0),
    }),
    default: { top: 0.13, bottom: 0.22, rightLower: 0.14, marginPx: 48 },
  },
  'compose.cta': {
    label: 'CTA end segment',
    schema: z.object({
      text: z.string(),
      durationSec: z.number().min(2).max(4),
      background: z.enum(['last_frame', 'chosen_frame']),
      zoom: z.boolean(),
      darken: z.number().min(0).max(1),
    }),
    default: {
      text: "Comment LINK and I'll DM you the link 👇",
      durationSec: 3,
      background: 'last_frame' as const,
      zoom: true,
      darken: 0.35,
    },
  },
  'compose.badgeSceneTypes': {
    label: 'Scene types that show the logo and price badge',
    schema: z.array(z.enum(SCENE_TYPES)),
    default: ['hold_up', 'pieces', 'wearing_front', 'wearing_alt'] as const,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
