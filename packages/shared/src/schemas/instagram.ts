import { z } from 'zod';

// ---------- Instagram: own account, keyword auto-replies, publishing ----------

export const InstagramConnectSchema = z.object({
  /** Long-lived Instagram User token from the Meta App Dashboard ("Generate token"). */
  accessToken: z.string().trim().min(20, 'Paste the token from the Meta App Dashboard'),
});
export type InstagramConnectInput = z.infer<typeof InstagramConnectSchema>;

export const InstagramAccountUpdateSchema = z.object({
  autoReply: z.boolean().optional(),
  poll: z.boolean().optional(),
});
export type InstagramAccountUpdate = z.infer<typeof InstagramAccountUpdateSchema>;

const Keyword = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(40)
  .regex(/^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u, 'Letters, numbers, dashes or underscores');

export const InstagramRuleSchema = z.object({
  keyword: Keyword,
  dmText: z.string().trim().min(1, 'Write the DM').max(1000),
  commentReply: z.string().trim().max(300).nullable().default(null),
  mediaId: z.string().trim().min(1).nullable().default(null),
  matchDms: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type InstagramRuleInput = z.input<typeof InstagramRuleSchema>;

export const InstagramPublishSchema = z.object({
  renderId: z.string().min(1),
  caption: z.string().max(2200, 'Instagram captions are at most 2,200 characters'),
  firstComment: z.string().trim().max(2200).nullable().default(null),
  shareToFeed: z.boolean().default(true),
  /** Creates a keyword rule for this Reel once it's live. */
  autoReply: z
    .object({
      keyword: Keyword,
      dmText: z.string().trim().min(1).max(1000),
      commentReply: z.string().trim().max(300).nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type InstagramPublishInput = z.input<typeof InstagramPublishSchema>;

export interface InstagramStatusDto {
  /** INSTAGRAM_APP_SECRET is set (needed to check webhook signatures and sign media links). */
  configured: boolean;
  /** PUBLIC_URL is set; publishing and webhooks need it. */
  publicUrl: string | null;
  webhookUrl: string | null;
  verifyTokenSet: boolean;
  connected: boolean;
  username: string | null;
  igUserId: string | null;
  tokenExpiresAt: string | null;
  autoReply: boolean;
  poll: boolean;
  lastWebhookAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
}

export interface InstagramRuleDto {
  id: string;
  keyword: string;
  dmText: string;
  commentReply: string | null;
  mediaId: string | null;
  matchDms: boolean;
  enabled: boolean;
  projectId: string | null;
  projectTitle: string | null;
  permalink: string | null;
  createdAt: string;
}

export interface InstagramReplyDto {
  id: string;
  kind: 'comment' | 'dm';
  mediaId: string | null;
  fromUsername: string | null;
  text: string;
  keyword: string | null;
  status: 'sent' | 'failed' | 'skipped';
  detail: string | null;
  createdAt: string;
}

export interface InstagramPostDto {
  id: string;
  projectId: string;
  renderId: string;
  status: 'queued' | 'uploading' | 'processing' | 'published' | 'failed';
  mediaId: string | null;
  permalink: string | null;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface InstagramMediaDto {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
}

/** Export step: what's needed to publish, earlier attempts, and form defaults from the caption package. */
export interface InstagramProjectDto {
  posts: InstagramPostDto[];
  ready: { connected: boolean; publicUrl: boolean; secret: boolean };
  defaults: { caption: string; firstComment: string | null; keyword: string; dmText: string };
}
