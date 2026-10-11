import type { PriceMode, SourceKey } from '@reel/shared';

export const SEED_SOURCES: Array<{
  key: SourceKey;
  displayName: string;
  priceMode: PriceMode;
  disclosureLines: string[];
  linkNotes: string;
}> = [
  {
    key: 'amazon',
    displayName: 'Amazon',
    // Amazon Associates restricts exact prices in static content.
    priceMode: 'under_band',
    disclosureLines: ['Ad · Affiliate link', 'As an Amazon Associate I earn from qualifying purchases.'],
    linkNotes: 'Use your Associates tracking link (SiteStripe short link).',
  },
  {
    key: 'myntra',
    displayName: 'Myntra',
    priceMode: 'exact',
    disclosureLines: ['Ad · Affiliate link'],
    linkNotes: 'Paste the affiliate link from your affiliate dashboard.',
  },
  {
    key: 'meesho',
    displayName: 'Meesho',
    priceMode: 'exact',
    disclosureLines: ['Ad · Affiliate link'],
    linkNotes: 'Paste the affiliate link from your affiliate dashboard.',
  },
];
