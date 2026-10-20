import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keywordFromCta, matchesKeyword, mediaSignature, parseWebhook, verifyMediaSignature, verifySignature } from './webhook';

describe('matchesKeyword', () => {
  it('matches whole words, any case, with emoji and punctuation around', () => {
    expect(matchesKeyword('LINK', 'link')).toBe(true);
    expect(matchesKeyword('Link pls 😍', 'LINK')).toBe(true);
    expect(matchesKeyword('need the link!!', 'link')).toBe(true);
    expect(matchesKeyword('@aanya link', 'link')).toBe(true);
  });

  it('does not match inside other words', () => {
    expect(matchesKeyword('linked it already', 'link')).toBe(false);
    expect(matchesKeyword('hyperlink', 'link')).toBe(false);
    expect(matchesKeyword('link_me', 'link')).toBe(false);
  });

  it('handles multi-word keywords and full-width text', () => {
    expect(matchesKeyword('send   me  LINK please', 'me link')).toBe(true);
    expect(matchesKeyword('ＬＩＮＫ', 'link')).toBe(true);
  });
});

describe('keywordFromCta', () => {
  it('reads the keyword after "Comment"', () => {
    expect(keywordFromCta("Comment LINK and I'll DM you the link 👇")).toBe('LINK');
    expect(keywordFromCta('comment “SAREE” for details')).toBe('SAREE');
    expect(keywordFromCta('Shop now')).toBeNull();
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const sig = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;

  it('accepts the right signature and rejects anything else', () => {
    expect(verifySignature(body, sig, 'secret')).toBe(true);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(Buffer.from('{}'), sig, 'secret')).toBe(false);
    expect(verifySignature(body, undefined, 'secret')).toBe(false);
    expect(verifySignature(body, 'sha256=abc', 'secret')).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
  });
});

describe('parseWebhook', () => {
  const own = new Set(['17841400000000000']);

  it('reads comments and DMs and drops echoes and our own comments', () => {
    const events = parseWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: '17841400000000000',
            time: 1_760_000_000,
            changes: [
              { field: 'comments', value: { id: 'c1', text: 'LINK', media: { id: 'm1' }, from: { id: 'u1', username: 'riya' } } },
              { field: 'comments', value: { id: 'c2', text: 'thanks!', media: { id: 'm1' }, from: { id: '17841400000000000', username: 'me' } } },
              { field: 'mentions', value: { id: 'x' } },
            ],
            messaging: [
              { sender: { id: 'u2' }, recipient: { id: '17841400000000000' }, timestamp: 1_760_000_000_000, message: { mid: 'mid1', text: 'link?' } },
              { sender: { id: '17841400000000000' }, recipient: { id: 'u2' }, timestamp: 1, message: { mid: 'mid2', text: 'hi', is_echo: true } },
            ],
          },
        ],
      },
      own,
    );
    expect(events).toEqual([
      { kind: 'comment', id: 'c1', text: 'LINK', mediaId: 'm1', fromId: 'u1', fromUsername: 'riya', createdAt: new Date(1_760_000_000_000) },
      { kind: 'dm', id: 'mid1', text: 'link?', fromId: 'u2', fromUsername: null, createdAt: new Date(1_760_000_000_000) },
    ]);
  });

  it('ignores other objects', () => {
    expect(parseWebhook({ object: 'page', entry: [] }, own)).toEqual([]);
    expect(parseWebhook(null, own)).toEqual([]);
  });
});

describe('media signatures', () => {
  it('verify until they expire, and only for the same file', () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const sig = mediaSignature('s', 'r1', 'final.mp4', exp);
    expect(verifyMediaSignature('s', 'r1', 'final.mp4', exp, sig)).toBe(true);
    expect(verifyMediaSignature('s', 'r1', 'cover.jpg', exp, sig)).toBe(false);
    expect(verifyMediaSignature('s', 'r2', 'final.mp4', exp, sig)).toBe(false);
    expect(verifyMediaSignature('s', 'r1', 'final.mp4', exp, sig, (exp + 1) * 1000)).toBe(false);
    expect(verifyMediaSignature('', 'r1', 'final.mp4', exp, sig)).toBe(false);
  });
});
