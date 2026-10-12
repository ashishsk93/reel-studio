import { describe, expect, it } from 'vitest';
import type { EditPlan } from '@reel/shared';
import { PromptService } from '../llm/prompt.service';
import { SEED_INFLUENCERS } from '../../prisma/seed-data/influencers';
import { buildEditPrompt, candidateList, editCandidates } from './edit-prompt';

const prompts = new PromptService();
const aanya = SEED_INFLUENCERS[0];

const candidates = editCandidates({
  influencerName: aanya.name,
  references: [
    { id: 'r2', tags: ['base_front'], path: 'refs/b.png', sortOrder: 1 },
    { id: 'r1', tags: ['anchor', 'closeup_front'], path: 'refs/a.jpg', sortOrder: 0 },
  ],
  products: [
    { id: 'p1', role: 'front', order: 0, path: 'product/1.jpg' },
    { id: 'p2', role: 'detail', order: 1, path: 'product/2.jpg' },
    { id: 'p3', role: 'detail', order: 2, path: 'product/3.webp' },
  ],
});

const plan: EditPlan = {
  title: 'Denser sleeve embroidery',
  instruction: 'make the white embroidery on both sleeves as dense as on the bodice',
  keep: 'her face, hair, pose and the background',
  attach: ['product_detail', 'anchor', 'product_front'],
  tool: 'gpt_image',
  checkAfter: ['Sleeve embroidery density', ' '],
};

describe('editCandidates', () => {
  it('keys references by tag and products by role, numbering repeats', () => {
    expect(candidates.map((c) => c.key)).toEqual(['anchor', 'closeup_front', 'base_front', 'product_front', 'product_detail', 'product_detail_2']);
    expect(candidateList(candidates)).toContain('- `anchor`: Aanya anchor');
  });
});

describe('buildEditPrompt', () => {
  it('puts the edited image first, then people, then products, and numbers the prompt to match', () => {
    const out = buildEditPrompt({ persona: aanya, edited: { id: 'a1', path: 'scenes/s/v2.png' }, plan, candidates, maxRefs: 4 }, prompts);
    expect(out.attachments.map((a) => a.fileName)).toEqual(['1_edit_this.png', '2_aanya_anchor.jpg', '3_product_detail.jpg', '4_product_front.jpg']);
    expect(out.prompt).toMatch(/^Edit image 1\. Image 2 shows Aanya\. Images 3 and 4 show the product\. Make the white embroidery/);
    expect(out.prompt).toContain('keep everything else in image 1 exactly the same: Her face, hair, pose and the background.');
    expect(out.prompt).toContain('Keep Aanya identical to image 2:');
    expect(out.prompt).toContain('No nose ring or nose piercing.');
    expect(out.prompt).not.toMatch(/\{|\}|\[|\]|\s{2}/);
    expect(out.checkAfter).toEqual(['Sleeve embroidery density']);
    expect(out.notes).toEqual([]);
  });

  it('drops the least useful attachments beyond the tool limit and says so', () => {
    const out = buildEditPrompt({ persona: aanya, edited: { id: 'a1', path: 'v1.jpg' }, plan, candidates, maxRefs: 2 }, prompts);
    expect(out.attachments.map((a) => a.label)).toEqual(['Image to edit', 'Product detail']);
    expect(out.prompt).toMatch(/^Edit image 1\. Image 2 shows the product\./);
    expect(out.prompt).toContain('Keep Aanya identical: ');
    expect(out.notes[0]).toContain('Aanya anchor, Product front');
  });

  it('ignores unknown keys', () => {
    const out = buildEditPrompt(
      { persona: aanya, edited: { id: 'a1', path: 'v1.jpg' }, plan: { ...plan, attach: ['nope', 'anchor'] }, candidates, maxRefs: 4 },
      prompts,
    );
    expect(out.attachments).toHaveLength(2);
  });
});
