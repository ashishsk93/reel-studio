import { matchesKeyword, type IgComment } from './webhook';

export interface RuleLike {
  mediaId: string;
  enabled: boolean;
}

/** Private replies to comments are allowed for 7 days after the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether this comment gets the Reel's DM: the Reel has an enabled DM, the comment has the
 * shared keyword, and Instagram still allows a private reply. Comments made before the DM was
 * set count too, since the link often only exists after the Reel is up.
 */
export function shouldReply(comment: IgComment, rule: RuleLike | null, keyword: string, now = Date.now()): boolean {
  if (!rule?.enabled || rule.mediaId !== comment.mediaId) return false;
  if (comment.createdAt && now - comment.createdAt.getTime() > PRIVATE_REPLY_WINDOW_MS) return false;
  return matchesKeyword(comment.text, keyword);
}
