import { describe, expect, it } from 'vitest';
import { advance, canOpenStep, isStepDone } from './steps.js';
import { ProjectCreateFieldsSchema, ProjectUpdateSchema } from './schemas/project.js';
import { ProductAnalysisChecked } from './llm/product.js';

describe('status machine', () => {
  it('moves forward and remembers the furthest status when going back', () => {
    const forward = advance({ status: 'draft', furthestStatus: 'draft' }, 'storyboard_ready');
    expect(forward).toEqual({ status: 'storyboard_ready', furthestStatus: 'storyboard_ready' });
    const back = advance(forward, 'product_analyzed');
    expect(back).toEqual({ status: 'product_analyzed', furthestStatus: 'storyboard_ready' });
  });

  it('opens steps by the furthest status reached', () => {
    expect(canOpenStep('storyboard', 'draft')).toBe(false);
    expect(canOpenStep('storyboard', 'product_analyzed')).toBe(true);
    expect(canOpenStep('images', 'storyboard_ready')).toBe(true);
    expect(isStepDone('analysis', 'product_analyzed')).toBe(true);
    expect(isStepDone('storyboard', 'product_analyzed')).toBe(false);
  });
});

describe('project schemas', () => {
  const base = {
    influencerId: 'i',
    sourceId: 's',
    productTitle: 'Lavender kurta set',
    priceInr: '1499',
    occasion: 'Diwali party',
  };

  it('coerces multipart strings and parses roles', () => {
    const parsed = ProjectCreateFieldsSchema.parse({ ...base, roles: '["front","back"]', productUrl: '' });
    expect(parsed.priceInr).toBe(1499);
    expect(parsed.roles).toEqual(['front', 'back']);
    expect(parsed.productUrl).toBeNull();
  });

  it('validates links, price and roles', () => {
    expect(ProjectCreateFieldsSchema.safeParse({ ...base, affiliateLink: 'amzn.to/x' }).success).toBe(false);
    expect(ProjectCreateFieldsSchema.safeParse({ ...base, priceInr: '0' }).success).toBe(false);
    expect(ProjectCreateFieldsSchema.safeParse({ ...base, roles: '["side"]' }).success).toBe(false);
    expect(ProjectUpdateSchema.parse({ affiliateLink: '' }).affiliateLink).toBeNull();
  });
});

describe('product analysis checks', () => {
  const item = { key: 'k', label: 'L', expected: 'E' };
  const valid = {
    spec: {
      category: 'kurta set',
      garmentType: 'kurta',
      pieces: [{ name: 'kurta', description: 'x' }],
      colours: { exactColourName: 'lavender', primary: 'lavender', secondary: [], sheen: 'matte' },
      fabric: { material: 'net', transparency: 'sheer', lined: 'lined', notes: '' },
      neckline: { front: 'round', back: 'unknown' },
      sleeves: 'full',
      fitSilhouette: 'A-line',
      length: 'ankle',
      openings: [],
      closures: [],
      waistDetails: '',
      surfaceWork: { type: 'embroidery', pattern: '', density: 'dense', motifs: '', placement: '' },
      hemDetails: '',
      backDetails: 'unknown',
      otherDistinctive: [],
      listingStyling: { jewellery: '', footwear: '', other: '' },
    },
    mustMatch: Array.from({ length: 6 }, () => item),
    unknowns: ['back'],
    garmentParagraph: 'Lavender kurta: sheer. Exact colour: lavender.',
  };

  it('requires 6-10 must-match items and a clean paragraph', () => {
    expect(ProductAnalysisChecked.safeParse(valid).success).toBe(true);
    expect(ProductAnalysisChecked.safeParse({ ...valid, mustMatch: [item] }).success).toBe(false);
    expect(ProductAnalysisChecked.safeParse({ ...valid, garmentParagraph: 'Kurta in [colour]. Exact colour: x.' }).success).toBe(false);
    expect(ProductAnalysisChecked.safeParse({ ...valid, garmentParagraph: 'Lavender kurta.' }).success).toBe(false);
  });
});
