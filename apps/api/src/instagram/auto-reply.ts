import { matchesKeyword, type IgEvent } from './webhook';

export interface RuleLike {
  id: string;
  keyword: string;
  mediaId: string | null;
  matchDms: boolean;
  enabled: boolean;
  createdAt: Date;
}

/** Private replies to comments are allowed for 7 days after the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The rule that answers this event, or null. A rule for this exact post wins over an
 * every-post rule, and comments written before a rule existed are left alone so turning
 * a rule on never DMs people who commented weeks ago.
 */
export function pickRule<R extends RuleLike>(event: IgEvent, rules: readonly R[], now = Date.now()): R | null {
  const at = event.createdAt?.getTime() ?? now;
  const candidates = rules.filter((r) => {
    if (!r.enabled || !matchesKeyword(event.text, r.keyword)) return false;
    if (at < r.createdAt.getTime() - 60_000) return false;
    if (event.kind === 'dm') return r.mediaId === null && r.matchDms;
    if (now - at > PRIVATE_REPLY_WINDOW_MS) return false;
    return r.mediaId === null || r.mediaId === event.mediaId;
  });
  return candidates.find((r) => r.mediaId !== null) ?? candidates[0] ?? null;
}
