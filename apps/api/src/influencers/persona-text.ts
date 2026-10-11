import type { ConditionalFeature } from '@reel/shared';

/** Capitalises the first letter and guarantees closing punctuation. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const capped = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

export function forbiddenSentences(forbidden: string[]): string {
  return forbidden.map(sentence).filter(Boolean).join(' ');
}

export function conditionalSentences(conditional: ConditionalFeature[]): string {
  return conditional
    .map(({ feature, rule }) => sentence(`${feature.trim().replace(/[.:;]$/, '')}: ${rule.trim()}`))
    .filter(Boolean)
    .join(' ');
}

/** "{forbidden rules}. {conditional rules}." from the prompt patterns. */
export function personaRules(persona: { forbiddenFeatures: string[]; conditionalFeatures: ConditionalFeature[] }): string {
  return [forbiddenSentences(persona.forbiddenFeatures), conditionalSentences(persona.conditionalFeatures)]
    .filter(Boolean)
    .join(' ');
}

/** Video prompts remind the model of forbidden features: ", with no nose ring or nose piercing". */
export function forbiddenReminder(forbidden: string[]): string {
  if (forbidden.length === 0) return '';
  const items = forbidden.map((f) => f.trim().replace(/[.]$/, '').replace(/^no\s+/i, ''));
  return `, with no ${items.join(' and no ')}`;
}

/** "Image 1 shows" / "Images 1 and 2 show" / "Images 1–3 show". */
export function personImagesLead(count: number): string {
  if (count <= 1) return 'Image 1 shows';
  if (count === 2) return 'Images 1 and 2 show';
  return `Images 1–${count} show`;
}

/** Collapses the double spaces left by empty template slots. */
export function tidyPrompt(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'influencer'
  );
}
