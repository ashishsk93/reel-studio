import type { PriceMode } from './enums.js';

/**
 * Every store a product can come from. To add one, append an entry here: the API creates its row
 * on startup (edits made on the Sources page are never overwritten) and the store pickers show it.
 * Its logo is uploaded on the Sources page; until then the pickers show a monogram in `brandColor`.
 */
export interface SourceDefinition {
  key: string;
  displayName: string;
  /** Default price on the badge; editable per store on the Sources page. */
  priceMode: PriceMode;
  disclosureLines: string[];
  linkNotes: string;
  /** Hostnames of product pages and short links; subdomains match too. Used to pick the store from a pasted link. */
  hosts: string[];
  /** Background of the monogram shown when no logo is uploaded. */
  brandColor: string;
  /** The store's own app sends the link by DM once it is generated, so Reel Studio's auto-reply starts off. */
  appSendsDmLink?: boolean;
}

export const SOURCES = [
  {
    key: 'amazon',
    displayName: 'Amazon',
    // Amazon Associates restricts exact prices in static content.
    priceMode: 'under_band',
    disclosureLines: ['Ad · Affiliate link', 'As an Amazon Associate I earn from qualifying purchases.'],
    linkNotes: 'Use your Associates tracking link (SiteStripe short link).',
    hosts: ['amazon.in', 'amazon.com', 'amzn.to', 'amzn.in', 'amzn.eu'],
    brandColor: '#232f3e',
  },
  {
    key: 'myntra',
    displayName: 'Myntra',
    priceMode: 'exact',
    disclosureLines: ['Ad · Affiliate link'],
    linkNotes: 'Paste the affiliate link from your affiliate dashboard.',
    hosts: ['myntra.com', 'myntr.it'],
    brandColor: '#ff3f6c',
  },
  {
    key: 'meesho',
    displayName: 'Meesho',
    priceMode: 'exact',
    disclosureLines: ['Ad · Affiliate link'],
    linkNotes: 'Paste the affiliate link from your affiliate dashboard.',
    hosts: ['meesho.com'],
    brandColor: '#9f2089',
    appSendsDmLink: true,
  },
  {
    key: 'savana',
    displayName: 'Savana',
    priceMode: 'exact',
    disclosureLines: ['Ad · Affiliate link'],
    linkNotes: 'Paste the affiliate link from your affiliate dashboard.',
    hosts: ['savana.com'],
    brandColor: '#111111',
  },
] as const satisfies readonly SourceDefinition[];

export type SourceKey = (typeof SOURCES)[number]['key'];
export const SOURCE_KEYS = SOURCES.map((s) => s.key) as [SourceKey, ...SourceKey[]];

export function sourceDefinition(key: string): SourceDefinition | undefined {
  return (SOURCES as readonly SourceDefinition[]).find((s) => s.key === key);
}

/** The store whose site a link points at, or null for other links (e.g. an affiliate network's redirect). */
export function sourceForUrl(url: string): SourceKey | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = SOURCES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return match?.key ?? null;
}
