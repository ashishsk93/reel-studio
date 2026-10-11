import { describe, expect, it } from 'vitest';
import { formatInr, priceLabel, underBandAmount } from './price.js';

describe('formatInr', () => {
  it('uses Indian digit grouping', () => {
    expect(formatInr(1499)).toBe('₹1,499');
    expect(formatInr(124999)).toBe('₹1,24,999');
    expect(formatInr(799)).toBe('₹799');
  });
});

describe('underBandAmount', () => {
  it.each([
    [349, 400],
    [900, 1000],
    [999, 1000],
    [1000, 1500],
    [1499, 1500],
    [1500, 2000],
    [4999, 5000],
    [5000, 6000],
    [12499, 13000],
  ])('%i → %i', (price, expected) => {
    expect(underBandAmount(price)).toBe(expected);
  });

  it('is always strictly above the price', () => {
    for (let price = 1; price < 20000; price += 37) {
      expect(underBandAmount(price)).toBeGreaterThan(price);
    }
  });
});

describe('priceLabel', () => {
  it('formats each mode', () => {
    expect(priceLabel(1499, 'exact')).toBe('₹1,499');
    expect(priceLabel(1499, 'under_band')).toBe('Under ₹1,500');
    expect(priceLabel(1499, 'hidden')).toBeNull();
  });
});
