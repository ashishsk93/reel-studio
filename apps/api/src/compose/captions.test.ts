import { describe, expect, it } from 'vitest';
import { assembleCaption, assembleDm, CTA_LINE } from './cover-captions.service';
import { sampleTimes } from './compose.service';

describe('caption assembly', () => {
  it('puts the hook, outfit lines, CTA, disclosures and hashtags in order', () => {
    const caption = assembleCaption(
      { hook: 'Lavender for Diwali? 💜', outfitLines: ['Net kurta with white embroidery.', 'Matching pants.'], hashtags: ['#SlayUrbanSociety', '#AanyaPicks'] },
      ['Ad · Affiliate link', 'As an Amazon Associate I earn from qualifying purchases.'],
    );
    expect(caption.split('\n')).toEqual([
      'Lavender for Diwali? 💜',
      'Net kurta with white embroidery.',
      'Matching pants.',
      '',
      CTA_LINE,
      '',
      'Ad · Affiliate link',
      'As an Amazon Associate I earn from qualifying purchases.',
      '',
      '#SlayUrbanSociety #AanyaPicks',
    ]);
  });

  it('adds the link and the disclosure to the DM, or a reminder when there is no link', () => {
    expect(assembleDm("Here's the link!", 'https://amzn.to/x', 'Ad · Affiliate link')).toBe("Here's the link!\n\nhttps://amzn.to/x\n(Ad · Affiliate link)");
    expect(assembleDm('Here you go', null, undefined)).toContain('add it on the Product step');
  });
});

describe('sampleTimes', () => {
  it('spreads detection frames inside the window', () => {
    expect(sampleTimes(1, 3.5)).toEqual([1.25, 1.75, 2.25, 2.75, 3.25]);
  });
});
