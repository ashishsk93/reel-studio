import type {
  InfluencerStatus,
  JobStatus,
  LlmTask,
  PriceMode,
  RefTag,
  SourceKey,
} from './enums.js';
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

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
