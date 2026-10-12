import { z } from 'zod';
import {
  ASSET_STATUSES,
  BoxSchema,
  CHECK_GROUPS,
  CHECK_RESULTS,
  IMAGE_MODELS,
  ISSUE_SEVERITIES,
  VERDICTS,
  type AssetDto,
  type AttachmentDto,
  type ChecklistItemDto,
  type EditPromptDto,
  type JobDto,
  type ReviewDto,
  type ReviewIssueDto,
} from '@reel/shared';
import type { Asset, Review } from '../generated/prisma/client';
import { readJson } from '../common/json';
import type { StorageService } from '../storage/storage.service';
import type { StoredAttachment, StoredEditPrompt } from './edit-prompt';

export const StoredAttachmentSchema = z.object({
  index: z.number(),
  kind: z.enum(['reference', 'product', 'asset']),
  id: z.string(),
  path: z.string(),
  label: z.string(),
  fileName: z.string(),
});

export const StoredEditPromptSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  tool: z.enum(IMAGE_MODELS),
  attachments: z.array(StoredAttachmentSchema),
  checkAfter: z.array(z.string()),
  notes: z.array(z.string()).default([]),
});

export const ChecklistSchema = z.array(
  z.object({ group: z.enum(CHECK_GROUPS), item: z.string(), result: z.enum(CHECK_RESULTS), note: z.string() }),
);
export const IssuesSchema = z.array(
  z.object({ severity: z.enum(ISSUE_SEVERITIES), description: z.string(), region: BoxSchema.nullable() }),
);

export function toAttachmentDto(a: StoredAttachment, storage: StorageService): AttachmentDto {
  return { index: a.index, label: a.label, kind: a.kind, id: a.id, url: storage.url(a.path), fileName: a.fileName };
}

export function toEditPromptDto(stored: StoredEditPrompt, zipRoute: string, storage: StorageService): EditPromptDto {
  return {
    title: stored.title,
    tool: stored.tool,
    card: {
      prompt: stored.prompt,
      attachments: stored.attachments.map((a) => toAttachmentDto(a, storage)),
      missing: [],
      notes: stored.notes,
    },
    checkAfter: stored.checkAfter,
    zipUrl: storage.apiUrl(zipRoute),
  };
}

export function readFixes(review: Review): StoredEditPrompt[] {
  return readJson(z.array(StoredEditPromptSchema), review.fixPrompts, []);
}

export function toReviewDto(review: Review, storage: StorageService): ReviewDto {
  return {
    id: review.id,
    assetId: review.assetId,
    verdict: readJson(z.enum(VERDICTS), review.verdict, 'warn'),
    summary: review.summary,
    checklist: readJson(ChecklistSchema, review.checklist, []) as ChecklistItemDto[],
    issues: readJson(IssuesSchema, review.issues, []) as ReviewIssueDto[],
    fixes: readFixes(review).map((fix, i) => toEditPromptDto(fix, `/reviews/${review.id}/fixes/${i}/attachments.zip`, storage)),
    model: review.model,
    createdAt: review.createdAt.toISOString(),
  };
}

export type AssetWithReviews = Asset & { reviews: Review[] };

/** `reviews` newest first; `job` is the latest review job for this asset, if any. */
export function toAssetDto(asset: AssetWithReviews, job: JobDto | undefined, storage: StorageService): AssetDto {
  const latest = [...asset.reviews].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const jobOpen = job && (job.status === 'queued' || job.status === 'running' || job.status === 'failed');
  // A failed job only matters if no review was saved after it.
  const showJob = jobOpen && !(job.status === 'failed' && latest && latest.createdAt.toISOString() > job.createdAt);
  return {
    id: asset.id,
    kind: asset.kind === 'video' ? 'video' : 'image',
    version: asset.version,
    url: storage.url(asset.path)!,
    width: asset.width,
    height: asset.height,
    status: readJson(z.enum(ASSET_STATUSES), asset.status, 'pending_review'),
    createdAt: asset.createdAt.toISOString(),
    review: latest ? toReviewDto(latest, storage) : null,
    reviewJob: showJob ? { id: job.id, status: job.status, error: job.error } : null,
  };
}
