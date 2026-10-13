import { describe, expect, it } from 'vitest';
import { assembleCaption, assembleDm, assembleDmFor, CTA_LINE, productLines } from './cover-captions.service';
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

describe('multi-product captions', () => {
  it('lists the products with their prices, and repeats no disclosure line', () => {
    const lines = productLines([
      { title: 'Teal kurti', priceLabel: 'Under ₹500' },
      { title: 'Mustard kurti', priceLabel: '₹449' },
    ]);
    expect(lines).toEqual(['1. Teal kurti – Under ₹500', '2. Mustard kurti – ₹449']);
    const caption = assembleCaption({ hook: 'Kurtis under ₹499 🛍️', outfitLines: [], hashtags: ['#SlayUrbanSociety'] }, ['Ad', 'Ad'], lines);
    expect(caption.split('\n')).toEqual(['Kurtis under ₹499 🛍️', '', ...lines, '', CTA_LINE, '', 'Ad', '', '#SlayUrbanSociety']);
    expect(productLines([{ title: 'One', priceLabel: '₹1' }])).toEqual([]);
  });

  it('numbers every link in the DM', () => {
    const dm = assembleDmFor('Here you go!', [{ title: 'Teal kurti', link: 'https://a.co/1' }, { title: 'Mustard kurti', link: null }], 'Ad');
    expect(dm.split('\n')).toEqual(['Here you go!', '', '1. Teal kurti: https://a.co/1', '2. Mustard kurti: add the affiliate link on the Product step', '(Ad)']);
    expect(assembleDmFor('Hi', [{ title: 'x', link: 'https://a.co/1' }], undefined)).toBe(assembleDm('Hi', 'https://a.co/1', undefined));
  });
});

describe('sampleTimes', () => {
  it('spreads detection frames inside the window', () => {
    expect(sampleTimes(1, 3.5)).toEqual([1.25, 1.75, 2.25, 2.75, 3.25]);
  });
});
