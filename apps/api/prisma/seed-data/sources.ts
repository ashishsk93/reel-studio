import { SOURCES } from '@reel/shared';

/** Seed rows straight from the store registry (the API also creates missing ones on startup). */
export const SEED_SOURCES = SOURCES.map(({ key, displayName, priceMode, disclosureLines, linkNotes }) => ({
  key,
  displayName,
  priceMode,
  disclosureLines: [...disclosureLines],
  linkNotes,
}));
