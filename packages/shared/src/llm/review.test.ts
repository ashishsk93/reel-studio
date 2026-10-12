import { describe, expect, it } from 'vitest';
import { assistantChecked, imageReviewChecked, type ImageReviewOutput } from './review.js';

const base: ImageReviewOutput = {
  verdict: 'warn',
  summary: 'Face matches; sleeve embroidery is sparser than the product.',
  identity: [{ item: 'Face match with the anchor', result: 'match', note: '' }],
  garment: [
    { key: 'embroidery_density', result: 'partial', note: 'sleeves sparser' },
    { key: 'colour', result: 'match', note: '' },
  ],
  anatomy: [{ item: 'Hands', result: 'match', note: '' }],
  artefacts: [],
  composition: [],
  faceBox: { x: 0.4, y: 0.2, w: 0.2, h: 0.12 },
  issues: [{ severity: 'major', description: 'Sleeve embroidery too sparse', region: { x: 0.1, y: 0.4, w: 0.2, h: 0.3 } }],
  fixes: [
    {
      title: 'Denser sleeves',
      instruction: 'Make the sleeve embroidery as dense as on the bodice, matching the product images.',
      keep: 'Her face, hair, pose and the background.',
      attach: ['product_detail', 'anchor'],
      tool: 'gpt_image',
      checkAfter: ['Sleeve density'],
    },
  ],
};

const schema = imageReviewChecked({ mustMatchKeys: ['embroidery_density', 'colour'], attachKeys: ['anchor', 'product_detail'] });
const messages = (value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('imageReviewChecked', () => {
  it('accepts a consistent review', () => {
    expect(messages(base)).toEqual([]);
  });

  it('requires every must-match key and no others', () => {
    expect(messages({ ...base, garment: base.garment.slice(0, 1) })).toContain('Missing must-match keys: colour');
    expect(messages({ ...base, garment: [...base.garment, { key: 'x', result: 'match', note: '' }] })).toContain('Unknown keys: x');
  });

  it('keeps the verdict consistent with the findings', () => {
    expect(messages({ ...base, verdict: 'pass' })).toContain('A mismatch or a major/critical issue cannot be a pass');
    expect(messages({ ...base, issues: [{ ...base.issues[0], severity: 'critical' }] })).toContain('A critical issue means fail');
    expect(messages({ ...base, fixes: [] })).toContain('Give at least one fix for warn or fail');
  });

  it('rejects unknown attachments, numbered images and placeholders in fixes', () => {
    const fix = base.fixes[0];
    expect(messages({ ...base, fixes: [{ ...fix, attach: ['turnaround'] }] })[0]).toContain('attach keys not in the list: turnaround');
    expect(messages({ ...base, fixes: [{ ...fix, instruction: 'Copy the sleeves from image 3' }] })[0]).toContain('refers to images by number');
    expect(messages({ ...base, fixes: [{ ...fix, keep: 'everything except [x]' }] })[0]).toContain('placeholders');
  });

  it('rejects boxes outside the frame', () => {
    expect(messages({ ...base, faceBox: { x: 0.9, y: 0.2, w: 0.3, h: 0.1 } })[0]).toContain('normalised');
  });
});

describe('assistantChecked', () => {
  it('allows a plain answer without an edit', () => {
    expect(assistantChecked(['anchor']).safeParse({ reply: 'Yes, the neckline matches.', edit: null }).success).toBe(true);
  });
  it('validates the edit like a fix', () => {
    const r = assistantChecked(['anchor']).safeParse({ reply: 'Done.', edit: { ...base.fixes[0], attach: ['product_detail'] } });
    expect(r.success).toBe(false);
  });
});
