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
  Verdict,
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

export interface ProjectSummaryDto {
  id: string;
  productTitle: string;
  priceInr: number;
  occasion: string;
  status: ProjectStatus;
  furthestStatus: ProjectStatus;
  influencer: { id: string; name: string; anchorUrl: string | null };
  source: { id: string; key: SourceKey; displayName: string };
  coverUrl: string | null;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
}

export interface ProjectDto extends ProjectSummaryDto {
  priceModeOverride: PriceMode | null;
  /** The mode actually used for the badge: the override, or the source's mode. */
  priceMode: PriceMode;
  priceLabel: string | null;
  productUrl: string | null;
  affiliateLink: string | null;
  videoMode: VideoMode;
  productImages: ProductImageDto[];
}

export interface ProductSpecDto {
  id: string;
  projectId: string;
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
  imagePrompt: string;
  promptOverride: boolean;
  card: PromptCardDto;
  updatedAt: string;
}

export interface StoryboardDto {
  scenes: SceneDto[];
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
}

export interface UsageSummaryDto {
  from: string | null;
  to: string | null;
  usdToInr: number;
  total: UsageRow;
  byMonth: UsageRow[];
  byProject: UsageRow[];
  byTask: UsageRow[];
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

export interface SceneImagesDto {
  scene: SceneDto;
  assets: AssetDto[];
  approvedAssetId: string | null;
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

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
