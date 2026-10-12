import { hasPlaceholder, type ConditionalFeature, type OutfitState } from '@reel/shared';
import type { PromptService } from '../llm/prompt.service';
import { imagesLead, personImagesLead, personaRules, sentence, tidyPrompt } from '../influencers/persona-text';

export interface PromptPersona {
  name: string;
  shortIdentity: string;
  homeOutfit: string;
  forbiddenFeatures: string[];
  conditionalFeatures: ConditionalFeature[];
}

export interface PromptScene {
  outfitState: OutfitState;
  showsProduct: boolean;
  description: string;
}

/** Which section-9 pattern a scene uses. */
export function templateFor(scene: PromptScene): string {
  if (!scene.showsProduct && scene.outfitState === 'own_clothes') return 'templates/image-plain';
  return scene.outfitState === 'wearing_product' ? 'templates/image-wearing' : 'templates/image-holding';
}

/** "an oversized white t-shirt and grey lounge shorts." — keeps the article lowercase mid-sentence. */
function clause(text: string): string {
  const trimmed = text.trim().replace(/[.]+$/, '');
  return trimmed ? `${trimmed}.` : 'her own casual clothes.';
}

export class PlaceholderError extends Error {}

/**
 * "Images 1 and 2 show Aanya. The other images show a product:" — numbered to match the
 * attachments, including when no reference images are attached yet.
 */
export function introSentence(template: string, name: string, personCount: number, productCount?: number): string {
  const person = personCount > 0 ? `${personImagesLead(personCount)} ${name}.` : '';
  if (template === 'templates/image-plain') return person;
  // With a background attached last, "the other images" would include it: number the products.
  if (productCount !== undefined && productCount > 0) return `${person} ${imagesLead(personCount + 1, productCount)} a product:`.trim();
  return personCount > 0 ? `${person} The other images show a product:` : 'The images show a product:';
}

/** "Image 5 shows her room: …" — the background attachment, always the last image. */
export function backgroundSentence(index: number | null): string {
  if (!index) return '';
  return `${imagesLead(index, 1)} the room: set the photo in exactly this room, keeping the walls, furniture, decor and lighting the same; use it only as the background.`;
}

/**
 * Assembles the copy-paste image prompt from the templates. Deterministic: the model only writes
 * the scene description, so identity, feature rules, garment text and realism lines are always
 * exactly what's stored.
 */
export function buildImagePrompt(
  input: { persona: PromptPersona; scene: PromptScene; garmentParagraph: string; personCount: number; backgroundIndex?: number | null },
  prompts: PromptService,
): string {
  const first = input.persona.name.split(' ')[0] || input.persona.name;
  const template = templateFor(input.scene);
  const prompt = tidyPrompt(
    prompts.render(template, {
      intro: introSentence(template, first, input.personCount, input.backgroundIndex ? input.backgroundIndex - 1 - input.personCount : undefined),
      background: backgroundSentence(input.backgroundIndex ?? null),
      name: first,
      garment: sentence(input.garmentParagraph),
      shortIdentity: sentence(input.persona.shortIdentity),
      personaRules: personaRules(input.persona),
      homeOutfit: clause(input.persona.homeOutfit),
      scene: sentence(input.scene.description),
    }),
  );
  if (hasPlaceholder(prompt)) {
    throw new PlaceholderError('The assembled prompt still contains a placeholder or brackets; edit the scene or garment text.');
  }
  return prompt;
}
