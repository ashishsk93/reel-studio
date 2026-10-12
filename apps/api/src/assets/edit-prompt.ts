import { hasPlaceholder, type EditPlan, type ImageModel } from '@reel/shared';
import type { PromptService } from '../llm/prompt.service';
import { imagesLead, imagesRef, personaRules, sentence, slugify, tidyPrompt } from '../influencers/persona-text';
import type { PromptPersona } from '../storyboard/prompt-builder';
import type { ProductCandidate, RefCandidate } from '../storyboard/reference-rules';

/** An image Claude may ask to attach to an edit, addressed by a stable key ("anchor", "product_front"). */
export interface EditCandidate {
  key: string;
  kind: 'reference' | 'product';
  id: string;
  path: string;
  label: string;
}

export interface StoredAttachment {
  index: number;
  kind: 'reference' | 'product' | 'asset';
  id: string;
  path: string;
  label: string;
  fileName: string;
}

/** What a review fix or an assistant answer stores: the assembled prompt and its attachments. */
export interface StoredEditPrompt {
  title: string;
  prompt: string;
  tool: ImageModel;
  attachments: StoredAttachment[];
  checkAfter: string[];
  notes: string[];
}

function ext(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot) : '.jpg';
}

/** Every reference tag (first image per tag) and every product image, with keys. */
export function editCandidates(input: {
  influencerName: string;
  references: RefCandidate[];
  products: ProductCandidate[];
}): EditCandidate[] {
  const first = input.influencerName.split(' ')[0] || input.influencerName;
  const out: EditCandidate[] = [];
  for (const ref of [...input.references].sort((a, b) => a.sortOrder - b.sortOrder)) {
    for (const tag of ref.tags) {
      if (out.some((c) => c.key === tag)) continue;
      out.push({ key: tag, kind: 'reference', id: ref.id, path: ref.path, label: `${first} ${tag.replaceAll('_', ' ')}` });
    }
  }
  const roleCount = new Map<string, number>();
  for (const p of [...input.products].sort((a, b) => a.order - b.order)) {
    const n = (roleCount.get(p.role) ?? 0) + 1;
    roleCount.set(p.role, n);
    out.push({
      key: n > 1 ? `product_${p.role}_${n}` : `product_${p.role}`,
      kind: 'product',
      id: p.id,
      path: p.path,
      label: `Product ${p.role}${n > 1 ? ` ${n}` : ''}`,
    });
  }
  return out;
}

/** The list shown to Claude so it can pick attachments by key. */
export function candidateList(candidates: EditCandidate[]): string {
  if (candidates.length === 0) return '(no reference images available)';
  return candidates.map((c) => `- \`${c.key}\`: ${c.label}`).join('\n');
}

export class EditPromptError extends Error {}

/**
 * Turns an edit plan into the paste-ready prompt. Image 1 is always the image being edited,
 * then the influencer's references, then product images, renumbered to match, within the
 * tool's reference limit. Identity and persona rules are appended verbatim.
 */
export function buildEditPrompt(
  input: {
    persona: PromptPersona;
    edited: { id: string; path: string };
    plan: EditPlan;
    candidates: EditCandidate[];
    maxRefs: number;
    /** An empty-room background reference: no identity rules. */
    noPerson?: boolean;
  },
  prompts: PromptService,
): StoredEditPrompt {
  const { persona, plan } = input;
  const first = persona.name.split(' ')[0] || persona.name;
  const notes: string[] = [];

  const wanted = [...new Set(plan.attach)]
    .map((key) => input.candidates.find((c) => c.key === key))
    .filter((c): c is EditCandidate => Boolean(c));
  const room = Math.max(0, input.maxRefs - 1);
  const kept = wanted.slice(0, room);
  if (wanted.length > room) {
    notes.push(`Left out to stay within ${input.maxRefs} images: ${wanted.slice(room).map((c) => c.label).join(', ')}.`);
  }
  const people = kept.filter((c) => c.kind === 'reference');
  const products = kept.filter((c) => c.kind === 'product');

  const slug = slugify(first);
  const attachments: StoredAttachment[] = [
    { index: 1, kind: 'asset', id: input.edited.id, path: input.edited.path, label: 'Image to edit', fileName: `1_edit_this${ext(input.edited.path)}` },
  ];
  for (const c of [...people, ...products]) {
    const index = attachments.length + 1;
    const name = c.kind === 'reference' ? `${slug}_${c.key}` : c.key;
    attachments.push({ index, kind: c.kind, id: c.id, path: c.path, label: c.label, fileName: `${index}_${name}${ext(c.path)}` });
  }

  const intro = [
    'Edit image 1.',
    people.length ? `${imagesLead(2, people.length)} ${first}.` : '',
    products.length ? `${imagesLead(2 + people.length, products.length)} the product.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const prompt = tidyPrompt(
    prompts.render(input.noPerson ? 'templates/image-edit-room' : 'templates/image-edit', {
      intro,
      instruction: sentence(plan.instruction),
      keep: sentence(plan.keep),
      name: first,
      faceRef: people.length ? ` to ${imagesRef(2, people.length)}` : '',
      shortIdentity: sentence(persona.shortIdentity),
      personaRules: personaRules(persona),
    }),
  );
  if (hasPlaceholder(prompt)) throw new EditPromptError('The edit prompt contains brackets or a placeholder.');

  return {
    title: plan.title.trim() || 'Edit',
    prompt,
    tool: plan.tool,
    attachments,
    checkAfter: plan.checkAfter.map((c) => c.trim()).filter(Boolean),
    notes,
  };
}
