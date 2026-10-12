import { describe, expect, it } from 'vitest';
import { REF_TAGS, creatorPromptChecked } from '@reel/shared';
import { PromptService } from '../llm/prompt.service';
import { SEED_INFLUENCERS } from '../../prisma/seed-data/influencers';
import { FRAMES, frameCard, frameFor, requiredSentences } from './creator-plan';

const prompts = new PromptService();
const aanya = SEED_INFLUENCERS[0];
const refs = [
  { id: 'a', tags: ['anchor' as const], path: 'refs/a.jpg', sortOrder: 0 },
  { id: 't', tags: ['turnaround' as const], path: 'refs/t.png', sortOrder: 1 },
];

describe('character creator plan', () => {
  it('covers every reference tag once, anchor first', () => {
    expect(FRAMES.map((f) => f.tag).sort()).toEqual([...REF_TAGS].sort());
    expect(FRAMES[0].tag).toBe('anchor');
    expect(FRAMES[0].attach).toEqual([]);
  });

  it('builds the anchor from the full identity block with no attachments', () => {
    const card = frameCard({ tag: 'anchor', prompt: '', promptOverride: false }, aanya, refs, prompts);
    expect(card.attachments).toEqual([]);
    expect(card.prompt).toMatch(/^Photorealistic portrait photo of Aanya Kapoor, a 22-year-old/);
    expect(card.prompt).toContain('No nose ring or nose piercing.');
    expect(card.prompt.endsWith('Aspect ratio 3:4.')).toBe(true);
    expect(card.prompt).not.toMatch(/\{|\}|\[|\]|\s{2}/);
  });

  it('numbers the attached references in later frames', () => {
    const card = frameCard({ tag: 'base_front', prompt: '', promptOverride: false }, aanya, refs, prompts);
    expect(card.attachments.map((a) => a.fileName)).toEqual(['1_aanya_anchor.jpg', '2_aanya_turnaround.png']);
    expect(card.prompt).toMatch(/^Images 1 and 2 show Aanya\. Keep Aanya identical: 22-year-old Punjabi woman/);
    expect(card.prompt).toContain('Full-body photo from head to feet');
    expect(card.missing).toEqual([]);
  });

  it('reports missing references and keeps hand-edited prompts', () => {
    const noTurnaround = frameCard({ tag: 'base_walk', prompt: '', promptOverride: false }, aanya, refs.slice(0, 1), prompts);
    expect(noTurnaround.prompt).toMatch(/^Image 1 shows Aanya\./);
    expect(noTurnaround.missing[0]).toContain('turnaround');
    const edited = frameCard({ tag: 'hands', prompt: 'My own prompt.', promptOverride: true }, aanya, refs, prompts);
    expect(edited.prompt).toBe('My own prompt.');
  });

  it('puts her home outfit and setting in the lifestyle frame', () => {
    const card = frameCard({ tag: 'lifestyle', prompt: '', promptOverride: false }, aanya, refs, prompts);
    expect(card.prompt).toContain('She is wearing an oversized white t-shirt and grey lounge shorts. She is in a cosy Delhi bedroom');
    expect(card.prompt).toContain('She is in a cosy Delhi bedroom');
  });

  it('requires identity, rules and numbering to survive a rewrite', () => {
    const frame = frameFor('base_front')!;
    const card = frameCard({ tag: 'base_front', prompt: '', promptOverride: false }, aanya, refs, prompts);
    const required = requiredSentences(aanya, frame, 2);
    expect(creatorPromptChecked(required).safeParse({ prompt: card.prompt }).success).toBe(true);
    const broken = creatorPromptChecked(required).safeParse({ prompt: card.prompt.replace('No nose ring or nose piercing.', '') });
    expect(broken.success).toBe(false);
  });
});
