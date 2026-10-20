import { describe, expect, it } from 'vitest';
import { PRIVATE_REPLY_WINDOW_MS, pickRule, type RuleLike } from './auto-reply';
import type { IgEvent } from './webhook';

const now = Date.UTC(2026, 9, 20, 12);
const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: 'r',
  keyword: 'link',
  mediaId: null,
  matchDms: false,
  enabled: true,
  createdAt: new Date(now - 60 * 60 * 1000),
  ...over,
});
const comment = (over: Partial<Extract<IgEvent, { kind: 'comment' }>> = {}): IgEvent => ({
  kind: 'comment',
  id: 'c1',
  text: 'LINK please',
  mediaId: 'm1',
  fromId: 'u1',
  fromUsername: 'riya',
  createdAt: new Date(now - 60_000),
  ...over,
});
const dm = (text: string): IgEvent => ({ kind: 'dm', id: 'mid', text, fromId: 'u1', fromUsername: null, createdAt: new Date(now - 1000) });

describe('pickRule', () => {
  it('prefers the rule for this post over an every-post rule', () => {
    const all = rule({ id: 'all' });
    const post = rule({ id: 'post', mediaId: 'm1' });
    expect(pickRule(comment(), [all, post], now)?.id).toBe('post');
    expect(pickRule(comment({ mediaId: 'm2' }), [all, post], now)?.id).toBe('all');
  });

  it('skips disabled rules, other keywords and other posts', () => {
    expect(pickRule(comment(), [rule({ enabled: false })], now)).toBeNull();
    expect(pickRule(comment(), [rule({ keyword: 'price' })], now)).toBeNull();
    expect(pickRule(comment(), [rule({ mediaId: 'm9' })], now)).toBeNull();
  });

  it('leaves comments from before the rule existed, and ones past the 7-day window', () => {
    expect(pickRule(comment({ createdAt: new Date(now - 2 * 60 * 60 * 1000) }), [rule({})], now)).toBeNull();
    const old = rule({ createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000) });
    expect(pickRule(comment({ createdAt: new Date(now - PRIVATE_REPLY_WINDOW_MS - 1000) }), [old], now)).toBeNull();
  });

  it('answers DMs only with every-post rules that opted in', () => {
    expect(pickRule(dm('link?'), [rule({})], now)).toBeNull();
    expect(pickRule(dm('link?'), [rule({ matchDms: true })], now)?.id).toBe('r');
    expect(pickRule(dm('link?'), [rule({ matchDms: true, mediaId: 'm1' })], now)).toBeNull();
  });
});
