import { describe, expect, it } from 'vitest';
import { SETTINGS, type ProductImageRole, type RefTag } from '@reel/shared';
import { personTagPlan, selectAttachments, wantsHairUp, type SelectionInput } from './reference-rules';

const rules = structuredClone(SETTINGS['storyboard.refRules'].default) as unknown as SelectionInput['rules'];

const ref = (id: string, tags: RefTag[], sortOrder = 0) => ({ id, tags, path: `refs/${id}.jpg`, sortOrder });
const product = (id: string, role: ProductImageRole, order: number) => ({ id, role, order, path: `product/${id}.png` });

const ALL_REFS = [
  ref('anc', ['anchor'], 0),
  ref('front', ['base_front'], 1),
  ref('three', ['base_three_quarter'], 2),
  ref('hairup', ['base_hair_up'], 3),
  ref('turn', ['turnaround'], 4),
  ref('hands', ['hands'], 5),
];
const PRODUCTS = [
  product('p-front', 'front', 0),
  product('p-back', 'back', 1),
  product('p-detail', 'detail', 2),
  product('p-pants', 'pants', 3),
];

function input(over: Partial<SelectionInput>): SelectionInput {
  return {
    influencerName: 'Aanya Kapoor',
    shotKind: 'full_body',
    showsProduct: true,
    productRoles: [],
    garmentText: 'round neck kurta set',
    references: ALL_REFS,
    products: PRODUCTS,
    rules,
    maxRefs: 4,
    ...over,
  };
}

const ids = (s: ReturnType<typeof selectAttachments>) => s.attachments.map((a) => a.id);

describe('reference selection rules', () => {
  it('always attaches the anchor first', () => {
    for (const shotKind of ['full_body', 'three_quarter', 'back', 'medium', 'closeup', 'hands'] as const) {
      expect(ids(selectAttachments(input({ shotKind }))) [0]).toBe('anc');
    }
  });

  it('full-body shots add base_front, or base_hair_up for halter, saree or backless outfits', () => {
    expect(ids(selectAttachments(input({ shotKind: 'full_body' })))).toEqual(['anc', 'front', 'p-front', 'p-detail']);
    expect(wantsHairUp('Backless halter-neck gown', rules.hairUpKeywords)).toBe(true);
    const halter = selectAttachments(input({ shotKind: 'full_body', garmentText: 'A halter neck co-ord' }));
    expect(ids(halter).slice(0, 2)).toEqual(['anc', 'hairup']);
  });

  it('three-quarter shots add base_three_quarter', () => {
    expect(ids(selectAttachments(input({ shotKind: 'three_quarter' }))).slice(0, 2)).toEqual(['anc', 'three']);
  });

  it('back views add the turnaround and are the only shots that get the back product image', () => {
    const back = selectAttachments(input({ shotKind: 'back', productRoles: ['back', 'front'] }));
    expect(ids(back)).toEqual(['anc', 'turn', 'p-back', 'p-front']);
    for (const shotKind of ['full_body', 'medium', 'hands'] as const) {
      expect(ids(selectAttachments(input({ shotKind, productRoles: ['back'] })))).not.toContain('p-back');
    }
  });

  it('close-ups and hand shots use the anchor only', () => {
    const hands = selectAttachments(input({ shotKind: 'hands', productRoles: ['detail'] }));
    expect(hands.personCount).toBe(1);
    expect(ids(hands)).toEqual(['anc', 'p-detail', 'p-front', 'p-pants']);
  });

  it('orders product images by the roles the scene asked for, then by default relevance', () => {
    const s = selectAttachments(input({ shotKind: 'medium', productRoles: ['pants', 'detail'], maxRefs: 10 }));
    expect(ids(s)).toEqual(['anc', 'p-pants', 'p-detail', 'p-front']);
  });

  it('stays within the tool reference limit, keeping the anchor and the best product image', () => {
    const one = selectAttachments(input({ maxRefs: 2 }));
    expect(ids(one)).toEqual(['anc', 'p-front']);
    expect(one.notes.join(' ')).toContain('Left out');
    expect(selectAttachments(input({ maxRefs: 3 })).attachments).toHaveLength(3);
  });

  it('falls back and reports missing references', () => {
    const onlyAnchor = selectAttachments(input({ references: [ref('anc', ['anchor'])], shotKind: 'three_quarter' }));
    expect(onlyAnchor.missing).toEqual(['No "base_three_quarter" reference for Aanya yet']);
    const noThree = selectAttachments(input({ references: [ref('anc', ['anchor']), ref('front', ['base_front'])], shotKind: 'three_quarter' }));
    expect(ids(noThree).slice(0, 2)).toEqual(['anc', 'front']);
    expect(noThree.notes[0]).toContain('using "base_front"');
    expect(selectAttachments(input({ references: [] })).missing[0]).toContain('"anchor"');
  });

  it('skips product images when the scene shows no product', () => {
    expect(ids(selectAttachments(input({ showsProduct: false, shotKind: 'medium' })))).toEqual(['anc']);
  });

  it('names files so the order is unambiguous', () => {
    const s = selectAttachments(input({ products: [...PRODUCTS, product('p-front2', 'front', 9)], productRoles: ['front'], maxRefs: 5 }));
    expect(s.attachments.map((a) => a.fileName)).toEqual([
      '1_aanya_anchor.jpg',
      '2_aanya_base_front.jpg',
      '3_product_front.png',
      '4_product_front_2.png',
      '5_product_detail.png',
    ]);
  });

  it('follows edited rules', () => {
    const custom = { ...rules, medium: ['base_front', 'hands'] as RefTag[] };
    expect(personTagPlan({ shotKind: 'medium', garmentText: '', rules: custom })).toEqual([['anchor'], ['base_front'], ['hands']]);
  });
});
