import { describe, expect, it } from 'vitest';
import { storyboardChecked, type StoryboardScene } from '@reel/shared';
import { PromptService } from '../llm/prompt.service';
import { SEED_INFLUENCERS } from '../../prisma/seed-data/influencers';
import { SAMPLE_GARMENT } from '../influencers/sample-prompt';
import { PlaceholderError, buildImagePrompt, introSentence, templateFor } from './prompt-builder';

const prompts = new PromptService();
const aanya = SEED_INFLUENCERS[0];

describe('buildImagePrompt', () => {
  it('uses the holding pattern with her home outfit for own-clothes scenes', () => {
    const prompt = buildImagePrompt(
      {
        persona: aanya,
        scene: { outfitState: 'own_clothes', showsProduct: true, description: 'She holds the kurta up against herself, smiling' },
        garmentParagraph: SAMPLE_GARMENT,
        personCount: 1,
      },
      prompts,
    );
    expect(prompt).toMatch(/^Image 1 shows Aanya\. The other images show a product: Lavender net/);
    expect(prompt).toContain('She is wearing an oversized white t-shirt and grey lounge shorts. She holds the kurta up');
    expect(prompt).toContain('No nose ring or nose piercing.');
    expect(prompt).toContain('The product must match the product images exactly');
    expect(prompt.endsWith('Aspect ratio 9:16.')).toBe(true);
    expect(prompt).not.toMatch(/\{|\}|\[|\]|\s{2}/);
  });

  it('uses the wearing pattern when she wears the product', () => {
    const prompt = buildImagePrompt(
      {
        persona: aanya,
        scene: { outfitState: 'wearing_product', showsProduct: true, description: 'Full-body front view on a balcony.' },
        garmentParagraph: SAMPLE_GARMENT,
        personCount: 2,
      },
      prompts,
    );
    expect(prompt).toMatch(/^Images 1 and 2 show Aanya\./);
    expect(prompt).toContain('Dress Aanya in this exact outfit');
    expect(prompt).not.toContain('lounge shorts');
  });

  it('numbers the products and names the background image when her room is attached', () => {
    const prompt = buildImagePrompt(
      {
        persona: aanya,
        scene: { outfitState: 'wearing_product', showsProduct: true, description: 'Full-body front view by her bedroom curtain.' },
        garmentParagraph: SAMPLE_GARMENT,
        personCount: 2,
        backgroundIndex: 5,
      },
      prompts,
    );
    expect(prompt).toMatch(/^Images 1 and 2 show Aanya\. Images 3 and 4 show a product: Lavender net/);
    expect(prompt).toContain('by her bedroom curtain. Image 5 shows the room: set the photo in exactly this room');
    expect(prompt).not.toMatch(/\{|\}|\[|\]|\s{2}/);
  });

  it('picks the plain pattern when no product is shown', () => {
    expect(templateFor({ outfitState: 'own_clothes', showsProduct: false, description: '' })).toBe('templates/image-plain');
  });

  it('refuses to produce a prompt with a placeholder', () => {
    expect(() =>
      buildImagePrompt(
        {
          persona: aanya,
          scene: { outfitState: 'wearing_product', showsProduct: true, description: 'Standing in [SET]' },
          garmentParagraph: SAMPLE_GARMENT,
          personCount: 1,
        },
        prompts,
      ),
    ).toThrow(PlaceholderError);
  });
});

describe('storyboard validation', () => {
  const scene = (over: Partial<StoryboardScene>): StoryboardScene => ({
    type: 'hold_up',
    purpose: 'Show the kurta',
    shotKind: 'medium',
    outfitState: 'own_clothes',
    showsProduct: true,
    setting: 'bedroom',
    place: null,
    description: 'She holds it up.',
    productRoles: ['front'],
    onScreenText: 'Lavender net kurta set',
    targetDurationSec: 2.5,
    imageModel: 'gpt_image',
    imageModelReason: 'detail',
    motion: 'smiles',
    ...over,
  });
  const constraints = { backKnown: false, pieceCount: 1, availableRoles: ['front', 'detail'], minTotalSec: 13, maxTotalSec: 17, placeCount: 0 };
  const check = (scenes: StoryboardScene[]) => storyboardChecked(constraints).safeParse({ scenes, notes: [] });

  it('accepts a sensible storyboard', () => {
    expect(check([scene({}), scene({}), scene({}), scene({}), scene({ targetDurationSec: 3 })]).success).toBe(true);
  });

  it('rejects back views when the back is unknown, single-piece "pieces" scenes and unknown roles', () => {
    const result = check([
      scene({ shotKind: 'back' }),
      scene({ type: 'pieces' }),
      scene({ productRoles: ['back'] }),
      scene({ onScreenText: 'Wow' }),
      scene({ description: 'In [location]' }),
      scene({}),
    ]);
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('back of the product is unknown');
    expect(messages).toContain('one piece');
    expect(messages).toContain('not uploaded: back');
    expect(messages).toContain('3-7 words');
    expect(messages).toContain('placeholders');
  });

  it('enforces the total duration', () => {
    const result = check([scene({ targetDurationSec: 5 }), scene({ targetDurationSec: 5 }), scene({ targetDurationSec: 5 }), scene({ targetDurationSec: 5 })]);
    expect(result.error!.issues[0].message).toContain('add up to 20s');
  });
});

describe('introSentence', () => {
  it('numbers images to match the attachments', () => {
    expect(introSentence('templates/image-wearing', 'Aanya', 2)).toBe('Images 1 and 2 show Aanya. The other images show a product:');
    expect(introSentence('templates/image-holding', 'Aanya', 0)).toBe('The images show a product:');
    expect(introSentence('templates/image-plain', 'Aanya', 1)).toBe('Image 1 shows Aanya.');
  });
});
