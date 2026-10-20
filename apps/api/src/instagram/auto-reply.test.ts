import { describe, expect, it } from 'vitest';
import { PRIVATE_REPLY_WINDOW_MS, shouldReply } from './auto-reply';
import type { IgComment } from './webhook';

const now = Date.UTC(2026, 9, 20, 12);
const comment = (over: Partial<IgComment> = {}): IgComment => ({
  id: 'c1',
  text: 'LINK please',
  mediaId: 'm1',
  fromId: 'u1',
  fromUsername: 'riya',
  createdAt: new Date(now - 60_000),
  ...over,
});

describe('shouldReply', () => {
  const rule = { mediaId: 'm1', enabled: true };

  it('replies to the keyword on a Reel with a DM', () => {
    expect(shouldReply(comment(), rule, 'link', now)).toBe(true);
  });

  it('needs an enabled DM for that same Reel', () => {
    expect(shouldReply(comment(), null, 'link', now)).toBe(false);
    expect(shouldReply(comment(), { ...rule, enabled: false }, 'link', now)).toBe(false);
    expect(shouldReply(comment({ mediaId: 'm2' }), rule, 'link', now)).toBe(false);
  });

  it('skips other words and comments past the 7-day window', () => {
    expect(shouldReply(comment({ text: 'so pretty' }), rule, 'link', now)).toBe(false);
    expect(shouldReply(comment({ createdAt: new Date(now - PRIVATE_REPLY_WINDOW_MS - 1000) }), rule, 'link', now)).toBe(false);
  });

  it('answers comments made before the DM was set', () => {
    expect(shouldReply(comment({ createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000) }), rule, 'link', now)).toBe(true);
  });
});
