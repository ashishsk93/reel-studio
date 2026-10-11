import type { PriceMode } from './enums.js';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** "₹1,499", "₹1,24,999" (Indian digit grouping). */
export function formatInr(amount: number): string {
  return `₹${inr.format(Math.round(amount))}`;
}

/** Rounding step for "Under ₹X": ₹100 below ₹1,000, ₹500 up to ₹4,999, ₹1,000 from ₹5,000. */
export function underBandStep(price: number): number {
  if (price < 1000) return 100;
  if (price < 5000) return 500;
  return 1000;
}

/** Smallest step multiple strictly above the price, so the label is always true. */
export function underBandAmount(price: number): number {
  const step = underBandStep(price);
  return (Math.floor(price / step) + 1) * step;
}

/** Badge text for a price under a display mode; null means logo only. */
export function priceLabel(price: number, mode: PriceMode): string | null {
  switch (mode) {
    case 'exact':
      return formatInr(price);
    case 'under_band':
      return `Under ${formatInr(underBandAmount(price))}`;
    case 'hidden':
      return null;
  }
}
