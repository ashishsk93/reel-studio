import type { AttachmentDto, PromptCardDto, RefTag } from '@reel/shared';
import type { ReferenceImage } from '../generated/prisma/client';
import type { PromptService } from '../llm/prompt.service';
import { personImagesLead, personaRules, sentence, slugify, tidyPrompt } from './persona-text';
import { refTags, sortReferences } from './influencer.mapper';

/** The quality-bar garment paragraph from the brief, used to test a persona without a project. */
export const SAMPLE_GARMENT =
  'Lavender net front-slit kurta set: a sheer lavender net kurta over a lavender lining, covered all over in dense white thread embroidery of vines, leaves, flowers and paisley-like motifs, with a heavier embroidered border near the hem ending in a small zigzag band. Round neckline with a small keyhole slit at the centre front. Full-length fitted sheer sleeves with the same white embroidery. Fitted bodice with a horizontal seam just under the bust; below it the kurta flares into an ankle-length A-line panel that is open at the centre front from the waist down. Plain, solid lavender straight-leg pants in a smooth matte fabric. Exact colour: soft lavender-lilac with white embroidery.';

interface PersonaForPrompt {
  name: string;
  shortIdentity: string;
  homeSetting: string;
  forbiddenFeatures: string[];
  conditionalFeatures: Array<{ feature: string; rule: string }>;
}

/**
 * Assembles a full-body "wearing the product" prompt with the sample garment, following the
 * reference-selection rules (anchor first, then base_front), so a new persona can be checked
 * in Higgsfield before it's used in a project.
 */
export function buildSamplePrompt(
  persona: PersonaForPrompt,
  references: ReferenceImage[],
  prompts: PromptService,
  fileUrl: (rel: string) => string | null,
): PromptCardDto {
  const refs = sortReferences(references);
  const wanted: RefTag[] = ['anchor', 'base_front'];
  const picked = wanted.flatMap((tag) => {
    const ref = refs.find((r) => refTags(r).includes(tag));
    return ref ? [{ tag, ref }] : [];
  });
  const missing = wanted.filter((tag) => !picked.some((p) => p.tag === tag));

  const first = persona.name.split(' ')[0];
  const personCount = Math.max(1, picked.length);
  const prompt = tidyPrompt(
    prompts.render('templates/image-wearing', {
      personImages: personImagesLead(personCount),
      name: first,
      garment: SAMPLE_GARMENT,
      shortIdentity: sentence(persona.shortIdentity),
      personaRules: personaRules(persona),
      scene: sentence(
        `Full-body front view of ${first} standing in ${persona.homeSetting.replace(/[.]$/, '') || 'a softly lit room'}, relaxed natural pose with one hand lightly at her waist, looking at the camera with a warm smile`,
      ),
    }),
  );

  const slug = slugify(first);
  const attachments: AttachmentDto[] = picked.map(({ tag, ref }, i) => ({
    index: i + 1,
    label: `${first} ${tag}`,
    kind: 'reference',
    id: ref.id,
    url: fileUrl(ref.path),
    fileName: `${i + 1}_${slug}_${tag}${ref.path.slice(ref.path.lastIndexOf('.'))}`,
  }));
  attachments.push({
    index: attachments.length + 1,
    label: 'Product front (from your project)',
    kind: 'product',
    id: 'sample-product',
    url: null,
    fileName: `${attachments.length + 1}_product_front.jpg`,
  });

  return {
    prompt,
    attachments,
    missing: missing.map((tag) => `No reference tagged "${tag}" yet`),
    notes: [
      'Uses the sample lavender kurta set; in a project the garment paragraph and product images come from the product analysis.',
      'Attach the images in the order listed.',
    ],
  };
}
