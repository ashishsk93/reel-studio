import { describe, expect, it } from 'vitest';
import { captionsChecked, copyRuleIssues, coverPickChecked } from './compose.js';

describe('copy rules', () => {
  it('flags claims the influencer cannot make', () => {
    expect(copyRuleIssues('So soft and comfy for all-day wear')).toHaveLength(1);
    expect(copyRuleIssues('Fits perfectly, true to size')[0]).toContain('fit');
    expect(copyRuleIssues('Premium quality fabric')[0]).toContain('quality');
    expect(copyRuleIssues('50% off today only')[0]).toContain('discount');
    expect(copyRuleIssues('Selling fast!')[0]).toContain('urgency');
    expect(copyRuleIssues('Arrives in 2 days')[0]).toContain('delivery');
  });

  it('allows factual, visual copy', () => {
    expect(copyRuleIssues('Lavender net kurta set with all-over white embroidery')).toEqual([]);
    expect(copyRuleIssues('Diwali fit, sorted 🪔 It feels festive')).toEqual([]);
  });
});

describe('captionsChecked', () => {
  const ok = {
    hook: 'Lavender for Diwali? Yes please 💜',
    outfitLines: ['Lavender kurta with white thread embroidery and matching pants.'],
    hashtags: ['#SlayUrbanSociety', '#AanyaPicks', '#DiwaliOutfit', '#KurtaSet', '#Lavender'],
    firstComment: null,
    dmMessage: "Here's the link you asked for!",
  };
  const schema = captionsChecked(['#SlayUrbanSociety', '#AanyaPicks']);

  it('accepts a clean package', () => {
    expect(schema.safeParse(ok).success).toBe(true);
  });

  it('requires the brand and influencer tags, valid hashtags and no links', () => {
    const r = schema.safeParse({ ...ok, hashtags: ['#DiwaliOutfit', '#KurtaSet', '#Lavender', '#Ethnic Wear', '#Festive'], dmMessage: 'Here: https://x.y' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages.some((m) => m.includes('#SlayUrbanSociety and #AanyaPicks'))).toBe(true);
    expect(messages.some((m) => m.includes('letters/numbers only'))).toBe(true);
    expect(messages.some((m) => m.includes('No links'))).toBe(true);
  });

  it('applies the copy rules', () => {
    expect(schema.safeParse({ ...ok, hook: 'So comfy you will live in it' }).success).toBe(false);
  });
});

describe('coverPickChecked', () => {
  it('needs a valid frame and three short titles', () => {
    const schema = coverPickChecked(4);
    expect(schema.safeParse({ best: 2, reason: 'clear face', titles: ['Diwali fit, sorted', 'Lavender moment 💜', 'Okay but this set'] }).success).toBe(true);
    expect(schema.safeParse({ best: 5, reason: '', titles: ['a', 'b', 'c'] }).success).toBe(false);
    expect(schema.safeParse({ best: 1, reason: '', titles: ['a', 'b'] }).success).toBe(false);
  });
});
