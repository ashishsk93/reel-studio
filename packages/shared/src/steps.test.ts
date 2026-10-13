import { describe, expect, it } from 'vitest';
import { advance, canOpenStep, isStepDone } from './steps.js';
import { ProjectCreateFieldsSchema, ProductUpdateSchema, ProjectUpdateSchema } from './schemas/project.js';
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
  const product = { title: 'Lavender kurta set', sourceId: 's', priceInr: '1499', imageCount: 2 };
  const base = { influencerId: 'i', title: 'Lavender kurta set', occasion: 'Diwali party' };
  const create = (over: Record<string, unknown> = {}, products: unknown[] = [product]) =>
    ProjectCreateFieldsSchema.safeParse({ ...base, products: JSON.stringify(products), ...over });

  it('parses multipart fields: the products JSON and the roles', () => {
    const parsed = create({ roles: '["front","back"]' }, [{ ...product, productUrl: '' }]);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.format).toBe('classic');
    expect(parsed.data!.products[0]).toMatchObject({ priceInr: 1499, productUrl: null, note: '' });
    expect(parsed.data!.roles).toEqual(['front', 'back']);
  });

  it('validates links, price and roles', () => {
    expect(create({}, [{ ...product, affiliateLink: 'amzn.to/x' }]).success).toBe(false);
    expect(create({}, [{ ...product, priceInr: '0' }]).success).toBe(false);
    expect(create({ roles: '["side"]' }).success).toBe(false);
    expect(ProductUpdateSchema.parse({ affiliateLink: '' }).affiliateLink).toBeNull();
  });

  it('never resets the format on a partial update', () => {
    expect(ProjectUpdateSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
  });

  it('checks the product count against the format', () => {
    expect(create({ format: 'haul' }).error!.issues[0].message).toContain('Price-cap haul takes 2–5 products (got 1)');
    expect(create({ format: 'haul' }, [product, product]).success).toBe(true);
    expect(create({ format: 'three_ways' }, [product, product]).error!.issues[0].message).toContain('takes 1 product (got 2)');
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
