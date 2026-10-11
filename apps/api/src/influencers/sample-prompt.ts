import type { PromptCardDto } from '@reel/shared';
import type { ReferenceImage } from '../generated/prisma/client';
import type { PromptService } from '../llm/prompt.service';
import { buildImagePrompt, type PromptPersona } from '../storyboard/prompt-builder';
import { selectAttachments, type RefRules } from '../storyboard/reference-rules';
import { refTags } from './influencer.mapper';

/** The quality-bar garment paragraph from the brief, used to test a persona without a project. */
export const SAMPLE_GARMENT =
  'Lavender net front-slit kurta set: a sheer lavender net kurta over a lavender lining, covered all over in dense white thread embroidery of vines, leaves, flowers and paisley-like motifs, with a heavier embroidered border near the hem ending in a small zigzag band. Round neckline with a small keyhole slit at the centre front. Full-length fitted sheer sleeves with the same white embroidery. Fitted bodice with a horizontal seam just under the bust; below it the kurta flares into an ankle-length A-line panel that is open at the centre front from the waist down. Plain, solid lavender straight-leg pants in a smooth matte fabric. Exact colour: soft lavender-lilac with white embroidery.';

/**
 * A full-body "wearing the product" prompt with the sample garment, built with the same
 * selection rules and templates as the storyboard, so a persona can be checked in Higgsfield
 * before it's used in a project.
 */
export function buildSamplePrompt(
  persona: PromptPersona & { homeSetting: string },
  references: ReferenceImage[],
  options: { prompts: PromptService; rules: RefRules; maxRefs: number; fileUrl: (rel: string) => string | null },
): PromptCardDto {
  const first = persona.name.split(' ')[0];
  const selection = selectAttachments({
    influencerName: persona.name,
    shotKind: 'full_body',
    showsProduct: false, // no real product; a placeholder slot is listed below instead
    productRoles: [],
    garmentText: SAMPLE_GARMENT,
    references: references.map((r) => ({ id: r.id, tags: refTags(r), path: r.path, sortOrder: r.sortOrder })),
    products: [],
    rules: options.rules,
    maxRefs: options.maxRefs,
  });
  const setting = persona.homeSetting.replace(/[.]$/, '') || 'a softly lit room';
  const prompt = buildImagePrompt(
    {
      persona,
      scene: {
        outfitState: 'wearing_product',
        showsProduct: true,
        description: `Full-body front view of ${first} standing in ${setting}, relaxed natural pose with one hand lightly at her waist, looking at the camera with a warm smile`,
      },
      garmentParagraph: SAMPLE_GARMENT,
      personCount: selection.personCount,
    },
    options.prompts,
  );

  const attachments = selection.attachments.map((a) => ({
    index: a.index,
    label: a.label,
    kind: a.kind,
    id: a.id,
    url: options.fileUrl(a.path),
    fileName: a.fileName,
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
    missing: selection.missing,
    notes: [
      'Uses the sample lavender kurta set; in a project the garment paragraph and product images come from the product analysis.',
      ...selection.notes,
      'Attach the images in the order listed.',
    ],
  };
}
