import type {
  AssetStatus,
  CheckGroup,
  CheckResult,
  CreatorTaskStatus,
  ImageModel,
  IssueSeverity,
  InfluencerStatus,
  JobStatus,
  LlmTask,
  OutfitState,
  PriceMode,
  ProductImageRole,
  ProjectStatus,
  RefTag,
  SceneType,
  ShotKind,
  SourceKey,
  StoryFormat,
  Verdict,
  VideoFixKind,
  VideoJobPurpose,
  VideoMode,
} from './enums.js';
import type { Box } from './llm/review.js';
import type { MustMatchItem, ProductSpec } from './llm/product.js';
import type { ConditionalFeature } from './schemas/influencer.js';

/** Response shapes shared by the API and the web app. Dates are ISO strings. */

export interface ReferenceImageDto {
  id: string;
  influencerId: string;
  path: string;
  url: string;
  width: number;
  height: number;
  tags: RefTag[];
  note: string;
  sortOrder: number;
  createdAt: string;
}

export interface InfluencerDto {
  id: string;
  slug: string;
  name: string;
  age: number;
  city: string;
  identityBlock: string;
  shortIdentity: string;
  voiceNotes: string;
  exampleLines: string[];
  personality: string;
  lane: string;
  hashtag: string;
  signatureDetails: string[];
  forbiddenFeatures: string[];
  conditionalFeatures: ConditionalFeature[];
  defaultStyling: string;
  homeOutfit: string;
  homeSetting: string;
  status: InfluencerStatus;
  createdAt: string;
  updatedAt: string;
  anchor: ReferenceImageDto | null;
  referenceCount: number;
}

export interface InfluencerDetailDto extends InfluencerDto {
  references: ReferenceImageDto[];
  creatorBrief: Record<string, unknown> | null;
}

export interface AttachmentDto {
  index: number;
  label: string;
  kind: 'reference' | 'product' | 'asset';
  id: string;
  url: string | null;
  fileName: string;
}

export interface PromptCardDto {
  prompt: string;
  attachments: AttachmentDto[];
  missing: string[];
  notes: string[];
}

export interface ProductImageDto {
  id: string;
  path: string;
  url: string;
  width: number;
  height: number;
  role: ProductImageRole;
  order: number;
}

export interface ProductSourceDto {
  id: string;
  key: SourceKey;
  displayName: string;
  logoUrl: string | null;
}

export interface ProductDto {
  id: string;
  /** 1-based, as used in storyboards and the DM. */
  number: number;
  title: string;
  note: string;
  source: ProductSourceDto;
  priceInr: number;
  priceModeOverride: PriceMode | null;
  /** The mode actually used for the badge: the override, or the store's mode. */
  priceMode: PriceMode;
  priceLabel: string | null;
  productUrl: string | null;
  affiliateLink: string | null;
  images: ProductImageDto[];
  analyzed: boolean;
}

export interface ProjectSummaryDto {
  id: string;
  format: StoryFormat;
  /** The Reel's headline (classic: the product title). */
  title: string;
  occasion: string;
  status: ProjectStatus;
  furthestStatus: ProjectStatus;
  influencer: { id: string; name: string; anchorUrl: string | null };
  productCount: number;
  /** Lowest and highest product price. */
  priceRange: { min: number; max: number };
  /** The stores of its products, without repeats. */
  sources: Array<{ id: string; key: SourceKey; displayName: string }>;
  coverUrl: string | null;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
}

export interface ProjectDto extends ProjectSummaryDto {
  videoMode: VideoMode;
  products: ProductDto[];
}

export interface ProductSpecDto {
  id: string;
  projectId: string;
  productId: string;
  spec: ProductSpec;
  mustMatch: MustMatchItem[];
  unknowns: string[];
  garmentParagraph: string;
  version: number;
  editedByUser: boolean;
  updatedAt: string;
}

export interface SceneDto {
  id: string;
  projectId: string;
  order: number;
  type: SceneType;
  purpose: string;
  shotKind: ShotKind;
  outfitState: OutfitState;
  showsProduct: boolean;
  setting: string;
  description: string;
  productRoles: ProductImageRole[];
  onScreenText: string;
  targetDurationSec: number;
  imageModel: ImageModel;
  imageModelReason: string;
  motion: string;
  backgroundId: string | null;
  productId: string | null;
  imagePrompt: string;
  promptOverride: boolean;
  card: PromptCardDto;
  updatedAt: string;
}

/** One of the influencer's places (a reference tagged "background"), offered as a scene's background. */
export interface BackgroundDto {
  id: string;
  /** 1-based number the storyboard uses. */
  number: number;
  note: string;
  url: string;
}

export interface StoryboardDto {
  scenes: SceneDto[];
  backgrounds: BackgroundDto[];
  /** The project's products, numbered as the storyboard refers to them. */
  products: Array<{ id: string; number: number; title: string; priceLabel: string | null }>;
  notes: string[];
  totalSec: number;
  ctaSec: number;
}

export interface SourceDto {
  id: string;
  key: SourceKey;
  displayName: string;
  logoUrl: string | null;
  priceMode: PriceMode;
  disclosureLines: string[];
  linkNotes: string;
}

export interface JobDto {
  id: string;
  type: string;
  status: JobStatus;
  projectId: string | null;
  progress: number;
  message: string;
  error: string | null;
  result: unknown;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type JobEvent = { kind: 'job'; job: JobDto };

export interface UsageRow {
  key: string;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Projects only: Kling credits of the uploaded video generations (estimated from each job's length). */
  klingCredits?: number;
  /** Projects only: false when the project was deleted. */
  exists?: boolean;
}

export interface UsageSummaryDto {
  from: string | null;
  to: string | null;
  projectId: string | null;
  usdToInr: number;
  total: UsageRow;
  failedCalls: number;
  /** Share of input tokens served from the prompt cache (0–1). */
  cacheHitRate: number;
  klingCredits: number;
  /** Reels rendered in the range and their average Claude cost. */
  reels: { count: number; avgCostUsd: number };
  /** One entry per day of the range (at most the last 60 days), oldest first. */
  byDay: Array<{ date: string; calls: number; costUsd: number }>;
  byMonth: UsageRow[];
  byProject: UsageRow[];
  byTask: UsageRow[];
  byModel: UsageRow[];
  recent: Array<{
    id: string;
    task: LlmTask;
    model: string;
    projectId: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    latencyMs: number;
    ok: boolean;
    createdAt: string;
  }>;
}

export interface HealthDto {
  ok: boolean;
  llmMode: string;
  hasApiKey: boolean;
  /** OpenAI's Decisions API is configured (OPENAI_API_KEY) and used for the app's decisions. */
  decisions: boolean;
  /** Set when a key is configured but OpenAI refused it (e.g. no access to the model); decisions are off until restart. */
  decisionsBlocked: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  dataDir: string;
  modelDefault: string;
  modelReview: string;
}

// ---------- Step 4: generated images, reviews, assistant ----------

export interface ChecklistItemDto {
  group: CheckGroup;
  item: string;
  result: CheckResult;
  note: string;
}

export interface ReviewIssueDto {
  severity: IssueSeverity;
  description: string;
  region: Box | null;
}

/** A paste-ready edit prompt (review fix or assistant answer) with its ordered attachments. */
export interface EditPromptDto {
  title: string;
  tool: ImageModel;
  card: PromptCardDto;
  checkAfter: string[];
  zipUrl: string;
}

export interface ReviewDto {
  id: string;
  assetId: string;
  verdict: Verdict;
  summary: string;
  checklist: ChecklistItemDto[];
  issues: ReviewIssueDto[];
  fixes: EditPromptDto[];
  model: string;
  createdAt: string;
}

export interface AssetDto {
  id: string;
  kind: 'image' | 'video';
  version: number;
  url: string;
  width: number;
  height: number;
  status: AssetStatus;
  createdAt: string;
  review: ReviewDto | null;
  /** The latest review job when it is queued, running or failed. */
  reviewJob: { id: string; status: JobStatus; error: string | null } | null;
}

/** The version to approve among several reviewed ones (OpenAI Decisions' pick, or the rules' as fallback). */
export interface VersionPickDto {
  assetId: string;
  version: number;
  /** The decision model's confidence (0–1); null when the rules decided. */
  confidence: number | null;
  by: 'decisions' | 'rules';
  note: string;
}

export interface SceneImagesDto {
  scene: SceneDto;
  assets: AssetDto[];
  approvedAssetId: string | null;
  recommendation: VersionPickDto | null;
}

export interface ImagesStepDto {
  scenes: SceneImagesDto[];
  approved: number;
  total: number;
}

export interface AssistantMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  edit: EditPromptDto | null;
  /** Video assets: the suggested change (a replacement shot or a prompt rewrite). */
  videoFix: VideoFixDto | null;
  createdAt: string;
}

export interface CreatorTaskDto {
  id: string;
  influencerId: string;
  order: number;
  tag: RefTag;
  purpose: string;
  /** "locked" until the anchor is approved (except for the anchor itself). */
  status: CreatorTaskStatus;
  imageModel: ImageModel;
  modelReason: string;
  aspect: string;
  tips: string[];
  promptOverride: boolean;
  card: PromptCardDto;
  /** The reference image this frame produced (or one already tagged with it). */
  reference: ReferenceImageDto | null;
  assets: AssetDto[];
}

// ---------- Steps 5–6: video prompts, videos, segments ----------

/** A shot as planned: where it should sit in the generated video. */
export interface ExpectedShotDto {
  sceneId: string;
  sceneOrder: number;
  start: number;
  end: number;
  /** Seconds of this scene used in the Reel. */
  targetSec: number;
  text: string;
}

/** A shot as found in an uploaded video, with the window used in the Reel. */
export interface ShotBoundDto {
  sceneId: string;
  start: number;
  end: number;
  inSec: number;
  outSec: number;
  /** A detected cut was matched to this shot's start (always true for the first shot). */
  matched: boolean;
  /** Edited by hand in the timeline; reviews no longer move it. */
  manual: boolean;
}

export interface VideoProbeDto {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
  vfr: boolean;
  rotation: number;
}

export interface VideoShotReviewDto {
  shot: number;
  sceneId: string;
  verdict: Verdict;
  matchesScene: boolean;
  notes: string;
  issues: Array<{ severity: IssueSeverity; description: string; fromSec: number | null; toSec: number | null }>;
  usableFrom: number | null;
  usableTo: number | null;
  /** Start of the best window Claude picked, or null (older reviews). */
  bestFrom?: number | null;
  suggestedIn: number;
  suggestedOut: number;
}

export interface VideoFixDto {
  title: string;
  kind: VideoFixKind;
  shot: number | null;
  sceneId: string | null;
  instruction: string;
  /** regenerate_shot: the new motion line (null keeps the scene's). */
  motion: string | null;
  /** regenerate_shot: a single-scene Kling prompt with its start image. */
  card: PromptCardDto | null;
  zipUrl: string | null;
  /** From the modification assistant: what to check in the new video. */
  checkAfter?: string[];
}

export interface VideoReviewDto {
  id: string;
  verdict: Verdict;
  summary: string;
  shots: VideoShotReviewDto[];
  fixes: VideoFixDto[];
  model: string;
  createdAt: string;
}

export interface VideoAssetDto {
  id: string;
  version: number;
  url: string;
  /** CFR H.264 copy used for playback, frames and the render. */
  normalizedUrl: string | null;
  status: AssetStatus;
  createdAt: string;
  width: number;
  height: number;
  durationSec: number;
  probe: VideoProbeDto | null;
  cuts: number[] | null;
  shotBounds: ShotBoundDto[] | null;
  frames: Array<{ t: number; url: string }>;
  review: VideoReviewDto | null;
  /** Latest processing or review job while it is queued, running or failed. */
  processing: { type: 'process' | 'review'; status: JobStatus; message: string; progress: number; error: string | null } | null;
}

export interface VideoJobDto {
  id: string;
  mode: VideoMode;
  purpose: VideoJobPurpose;
  order: number;
  active: boolean;
  title: string;
  sceneIds: string[];
  durationSec: number;
  expectedShots: ExpectedShotDto[];
  settings: { resolution: string; sound: boolean; durationSec: number };
  creditEstimate: number;
  promptOverride: boolean;
  card: PromptCardDto;
  zipUrl: string;
  assets: VideoAssetDto[];
  approvedAssetId: string | null;
  recommendation: VersionPickDto | null;
}

export interface SegmentDto {
  id: string;
  sceneId: string;
  assetId: string;
  videoJobId: string | null;
  order: number;
  inSec: number;
  outSec: number;
  suggestedInSec: number | null;
  suggestedOutSec: number | null;
  onScreenText: string;
}

export interface VideoStepDto {
  mode: VideoMode;
  /** Active jobs of the current mode, then replacement jobs. */
  jobs: VideoJobDto[];
  totalSec: number;
  totalCredits: number;
  scenes: Array<{ id: string; order: number; type: SceneType; onScreenText: string; targetDurationSec: number; imageUrl: string | null }>;
  segments: SegmentDto[];
  /** Scenes without an approved video window yet. */
  missingSceneIds: string[];
}

// ---------- Steps 7–8: compose, cover, captions, render ----------

export interface DetectionsDto {
  faces: Box[];
  hands: Box[];
  persons: Box[];
  /** Key garment areas from Claude (badge placement avoids them). */
  details: Box[];
  detected: boolean;
  detailsChecked: boolean;
}

export interface BadgePlacementDto {
  anchor: string;
  /** Top-left in output pixels (1080×1920). */
  x: number;
  y: number;
  scale: number;
  manual: boolean;
  overlapScore: number;
}

export interface ComposeSegmentDto {
  id: string;
  sceneId: string;
  sceneOrder: number;
  sceneType: SceneType;
  assetId: string;
  videoUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  inSec: number;
  outSec: number;
  onScreenText: string;
  textOverlayUrl: string;
  textBox: Box | null;
  /** Scene type is in Settings → badge scenes and the product is in frame. */
  badgeEligible: boolean;
  badgeEnabled: boolean;
  placement: BadgePlacementDto | null;
  placementWarning: string | null;
  detections: DetectionsDto;
  /** Frames (video times) used for detection and previews. */
  sampleTimes: number[];
  /** The product this segment shows (its badge: store logo and price), or null. */
  product: { id: string; title: string; priceLabel: string | null; priceMode: PriceMode; store: string; logoUrl: string | null } | null;
  /** The badge image at scale 1 (output pixels), or null when there is nothing to show. */
  badge: { url: string; w: number; h: number } | null;
}

export interface CtaDto {
  text: string;
  durationSec: number;
  background: 'last_frame' | 'chosen_frame';
  frame: { segmentId: string; timeSec: number } | null;
  zoom: boolean;
  darken: number;
}

export interface CoverDto {
  candidates: Array<{ segmentId: string; assetId: string; timeSec: number; url: string; label: string }>;
  best: number | null;
  reason: string;
  titleOptions: string[];
  chosen: { candidate: number; title: string } | null;
  plainUrl: string | null;
  titledUrl: string | null;
}

export interface CaptionPackageDto {
  caption: string;
  hashtags: string[];
  firstComment: string | null;
  dmTemplate: string;
  checklist: Array<{ item: string; done: boolean }>;
  updatedAt: string;
}

export interface ComposeStepDto {
  segments: ComposeSegmentDto[];
  safeZone: { top: number; bottom: number; rightLower: number; marginPx: number };
  cta: CtaDto;
  ctaPreviewUrl: string;
  cover: CoverDto;
  captions: CaptionPackageDto | null;
  music: { url: string; name: string; durationSec: number } | null;
  /** Reel length: segments plus the CTA. */
  totalSec: number;
  warnings: string[];
}

export interface QaCheckDto {
  label: string;
  ok: boolean;
  detail: string;
}

export interface RenderDto {
  id: string;
  status: JobStatus;
  createdAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  files: Array<{ name: string; url: string; bytes: number }>;
  zipUrl: string | null;
  qa: {
    checks: QaCheckDto[];
    blackFrames: Array<{ start: number; end: number; nearJoin: boolean }>;
    contactSheetUrl: string | null;
  } | null;
  warnings: string[];
  error: string | null;
  progress: number;
  message: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
