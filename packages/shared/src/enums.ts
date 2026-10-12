export const REF_TAGS = [
  'anchor',
  'turnaround',
  'base_front',
  'base_three_quarter',
  'base_walk',
  'base_hair_up',
  'closeup_front',
  'closeup_left',
  'closeup_right',
  'profile',
  'hands',
  'lifestyle',
] as const;
export type RefTag = (typeof REF_TAGS)[number];

export const SOURCE_KEYS = ['amazon', 'myntra', 'meesho'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const PRICE_MODES = ['exact', 'under_band', 'hidden'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const INFLUENCER_STATUSES = ['draft', 'creating', 'active', 'archived'] as const;
export type InfluencerStatus = (typeof INFLUENCER_STATUSES)[number];

export const PROJECT_STATUSES = [
  'draft',
  'product_analyzed',
  'storyboard_ready',
  'images_in_progress',
  'images_approved',
  'video_prompts_ready',
  'videos_in_progress',
  'videos_approved',
  'composed',
  'rendered',
  'posted',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRODUCT_IMAGE_ROLES = ['front', 'back', 'detail', 'pants', 'lifestyle', 'other'] as const;
export type ProductImageRole = (typeof PRODUCT_IMAGE_ROLES)[number];

export const SCENE_TYPES = [
  'unboxing',
  'hold_up',
  'pieces',
  'detail',
  'wearing_front',
  'wearing_alt',
  'custom',
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const OUTFIT_STATES = ['own_clothes', 'wearing_product'] as const;
export type OutfitState = (typeof OUTFIT_STATES)[number];

export const IMAGE_MODELS = ['gpt_image', 'nano_banana'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const VIDEO_MODES = ['multi_shot', 'single'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const ASSET_STATUSES = ['pending_review', 'approved', 'rejected'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const VERDICTS = ['pass', 'warn', 'fail'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LLM_TASKS = [
  'persona_draft',
  'persona_regenerate',
  'product_analysis',
  'garment_paragraph',
  'storyboard',
  'scene_prompt',
  'image_review',
  'reference_review',
  'creator_prompt',
  'video_review',
  'video_prompts',
  'assistant',
  'detail_regions',
  'placement_check',
  'cover_pick',
  'captions',
] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export const LLM_MODES = ['live', 'mock', 'record', 'replay'] as const;
export type LlmMode = (typeof LLM_MODES)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Framing of a scene; drives which reference images get attached. */
export const SHOT_KINDS = ['full_body', 'three_quarter', 'back', 'medium', 'closeup', 'hands'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export const TRANSPARENCY = ['opaque', 'semi_sheer', 'sheer'] as const;
export type Transparency = (typeof TRANSPARENCY)[number];

/** Review checklist groups. `framing` is used for character reference frames. */
export const CHECK_GROUPS = ['identity', 'garment', 'anatomy', 'artefacts', 'composition', 'framing'] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

export const CHECK_RESULTS = ['match', 'partial', 'mismatch'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const ISSUE_SEVERITIES = ['minor', 'major', 'critical'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** Stored statuses of a character-creator frame; "locked" is derived (no anchor yet). */
export const CREATOR_TASK_STATUSES = ['locked', 'ready', 'in_review', 'approved', 'skipped'] as const;
export type CreatorTaskStatus = (typeof CREATOR_TASK_STATUSES)[number];
