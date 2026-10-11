import { describe, expect, it } from 'vitest';
import { PromptService } from '../llm/prompt.service';
import { SEED_INFLUENCERS } from '../../prisma/seed-data/influencers';
import {
  forbiddenReminder,
  personImagesLead,
  personaRules,
  sentence,
  slugify,
  tidyPrompt,
} from './persona-text';
import { SETTINGS } from '@reel/shared';
import { buildSamplePrompt } from './sample-prompt';
import type { ReferenceImage } from '../generated/prisma/client';

const aanya = SEED_INFLUENCERS[0];

function ref(id: string, tags: string[], order: number): ReferenceImage {
  return {
    id,
    influencerId: 'i1',
    path: `influencers/i1/refs/${id}.jpg`,
    width: 900,
    height: 1600,
    tags,
    note: '',
    sortOrder: order,
    creatorTaskId: null,
    createdAt: new Date(2026, 0, order + 1),
  };
}

describe('persona text helpers', () => {
  it('builds forbidden and conditional rule sentences', () => {
    expect(personaRules(aanya)).toBe(
      'No nose ring or nose piercing. A small crescent-moon tattoo on the inside of her left wrist: show it only if the inside of her left wrist is visible in the frame; never anywhere else.',
    );
    expect(personaRules({ forbiddenFeatures: [], conditionalFeatures: [] })).toBe('');
  });

  it('writes the video forbidden reminder', () => {
    expect(forbiddenReminder(['no nose ring or nose piercing'])).toBe(', with no nose ring or nose piercing');
    expect(forbiddenReminder([])).toBe('');
  });

  it('formats small things', () => {
    expect(sentence('keep it')).toBe('Keep it.');
    expect(sentence('Done!')).toBe('Done!');
    expect(personImagesLead(1)).toBe('Image 1 shows');
    expect(personImagesLead(3)).toBe('Images 1–3 show');
    expect(tidyPrompt('a  b .  c')).toBe('a b. c');
    expect(slugify('Meera  Nair!')).toBe('meera-nair');
  });
});

describe('sample prompt', () => {
  const prompts = new PromptService();
  const options = (fileUrl: (rel: string) => string | null) => ({
    prompts,
    rules: structuredClone(SETTINGS['storyboard.refRules'].default) as never,
    maxRefs: 4,
    fileUrl,
  });

  it('fills the wearing template with no placeholders and orders attachments anchor first', () => {
    const card = buildSamplePrompt(
      aanya,
      [ref('base', ['base_front'], 0), ref('anc', ['anchor'], 1), ref('hands', ['hands'], 2)],
      options((rel) => `http://files/${rel}`),
    );
    expect(card.prompt).not.toMatch(/\{\{|\[|\]/);
    expect(card.prompt.startsWith('Images 1 and 2 show Aanya.')).toBe(true);
    expect(card.prompt).toContain('No nose ring or nose piercing.');
    expect(card.prompt).toContain('Aspect ratio 9:16.');
    expect(card.attachments.map((a) => a.fileName)).toEqual([
      '1_aanya_anchor.jpg',
      '2_aanya_base_front.jpg',
      '3_product_front.jpg',
    ]);
    expect(card.missing).toEqual([]);
  });

  it('reports missing reference tags', () => {
    const card = buildSamplePrompt(aanya, [], options(() => null));
    expect(card.prompt.startsWith('The images show a product:')).toBe(true);
    expect(card.missing).toHaveLength(2);
  });
});
