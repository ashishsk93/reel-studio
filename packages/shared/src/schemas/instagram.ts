import { z } from 'zod';

// ---------- Instagram: own account, keyword auto-replies, publishing ----------

export const InstagramConnectSchema = z.object({
  /** Long-lived Instagram User token from the Meta App Dashboard ("Generate token"). */
  accessToken: z.string().trim().min(20, 'Paste the token from the Meta App Dashboard'),
});
export type InstagramConnectInput = z.infer<typeof InstagramConnectSchema>;

const KEYWORD_RE = /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u;

/** "LINK, price,  shop" → ["LINK", "price", "shop"]: the stored form is comma-separated. */
export function splitKeywords(keywords: string): string[] {
  return keywords
    .split(',')
    .map((k) => k.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** Comma-separated trigger words, stored as "LINK, PRICE"; any one of them triggers the DM. */
const Keywords = z
  .string()
  .transform(splitKeywords)
  .superRefine((list, ctx) => {
    if (list.length === 0) ctx.addIssue({ code: 'custom', message: 'Add at least one keyword' });
    if (list.length > 20) ctx.addIssue({ code: 'custom', message: 'At most 20 keywords' });
    for (const k of list) {
      if (k.length < 2 || k.length > 40) ctx.addIssue({ code: 'custom', message: `"${k}": 2 to 40 characters` });
      else if (!KEYWORD_RE.test(k)) ctx.addIssue({ code: 'custom', message: `"${k}": letters, numbers, dashes or underscores` });
    }
  })
  .transform((list) => list.filter((k, i) => list.findIndex((o) => o.toLowerCase() === k.toLowerCase()) === i).join(', '));

/** Account switches and the reply settings every Reel shares. */
export const InstagramAccountUpdateSchema = z.object({
  autoReply: z.boolean().optional(),
  poll: z.boolean().optional(),
  keyword: Keywords.optional(),
  commentReply: z.string().trim().max(300).nullable().optional(),
});
export type InstagramAccountUpdate = z.infer<typeof InstagramAccountUpdateSchema>;

/** The DM one Reel's commenters get; each Reel has its own links. */
export const InstagramReelDmSchema = z.object({
  dmText: z.string().trim().min(1, 'Write the DM').max(1000),
  enabled: z.boolean().default(true),
  /** When the DM is first set: also DM people who already commented. Off by default, since they may have been answered by hand. */
  includeExisting: z.boolean().default(false),
});
export type InstagramReelDmInput = z.input<typeof InstagramReelDmSchema>;

export const InstagramPublishSchema = z.object({
  renderId: z.string().min(1),
  caption: z.string().max(2200, 'Instagram captions are at most 2,200 characters'),
  firstComment: z.string().trim().max(2200).nullable().default(null),
  shareToFeed: z.boolean().default(true),
  /** The DM for this Reel once it's live; null when another app replies (e.g. Meesho) or the link comes later. */
  dmText: z.string().trim().min(1).max(1000).nullable().default(null),
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
  keyword: string;
  commentReply: string | null;
  lastWebhookAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
}

/** One of your Reels and its DM. */
export interface InstagramReelDto {
  mediaId: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
  dmText: string | null;
  enabled: boolean;
  projectId: string | null;
  projectTitle: string | null;
  sent: number;
}

export interface InstagramReplyDto {
  id: string;
  mediaId: string | null;
  permalink: string | null;
  fromUsername: string | null;
  text: string;
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

/** Export step: what's needed to publish, earlier attempts, and form defaults from the caption package. */
export interface InstagramProjectDto {
  posts: InstagramPostDto[];
  ready: { connected: boolean; publicUrl: boolean; secret: boolean };
  defaults: { caption: string; firstComment: string | null; dmText: string; keyword: string };
  /** A Meesho product: its app replies to comments, and the link only exists once the Reel is up. */
  otherAppReplies: boolean;
}
