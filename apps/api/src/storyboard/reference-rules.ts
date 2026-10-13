import type { ProductImageRole, RefTag, SettingValue, ShotKind } from '@reel/shared';
import { slugify } from '../influencers/persona-text';

export type RefRules = SettingValue<'storyboard.refRules'>;

export interface RefCandidate {
  id: string;
  tags: RefTag[];
  path: string;
  sortOrder: number;
}

export interface ProductCandidate {
  id: string;
  role: ProductImageRole;
  order: number;
  path: string;
}

export interface SelectionInput {
  influencerName: string;
  shotKind: ShotKind;
  showsProduct: boolean;
  /** Roles the storyboard asked for, most relevant first. */
  productRoles: ProductImageRole[];
  /** Garment text used to spot halter / saree / backless outfits. */
  garmentText: string;
  references: RefCandidate[];
  products: ProductCandidate[];
  rules: RefRules;
  maxRefs: number;
  /** Her room for this scene (a reference tagged "background"), attached last. */
  background?: RefCandidate | null;
  /**
   * Transitions: the approved "before" still, attached last as the pose reference. It already shows
   * the room, so it replaces the background.
   */
  pose?: { id: string; path: string } | null;
}

export interface SelectedAttachment {
  index: number;
  kind: 'reference' | 'product' | 'asset';
  id: string;
  path: string;
  label: string;
  fileName: string;
}

export interface Selection {
  attachments: SelectedAttachment[];
  /** How many leading images show the influencer ("Images 1 and 2 show …"). */
  personCount: number;
  /** Number of the background image (always the last attachment), or null. */
  backgroundIndex: number | null;
  /** Number of the pose reference (always the last attachment), or null. */
  poseIndex: number | null;
  /** How many product images are attached (they follow the people). */
  productCount: number;
  missing: string[];
  notes: string[];
}

/** Fallback product relevance after the roles the storyboard asked for. */
const DEFAULT_ROLE_ORDER: ProductImageRole[] = ['front', 'detail', 'pants', 'lifestyle', 'other', 'back'];

export function wantsHairUp(garmentText: string, keywords: string[]): boolean {
  const text = garmentText.toLowerCase();
  return keywords.some((k) => k.trim() && text.includes(k.trim().toLowerCase()));
}

/** Reference tags to look for, in order, for a shot. Each entry lists alternatives (first match wins). */
export function personTagPlan(input: Pick<SelectionInput, 'shotKind' | 'garmentText' | 'rules'>): RefTag[][] {
  const { rules } = input;
  const plan: RefTag[][] = rules.alwaysFirst.map((t) => [t]);
  const add = (primary: readonly RefTag[], fallback: readonly RefTag[] = []) => {
    primary.forEach((tag, i) => plan.push([tag, ...(i === 0 ? fallback : [])]));
  };
  switch (input.shotKind) {
    case 'full_body': {
      const hairUp = wantsHairUp(input.garmentText, rules.hairUpKeywords);
      add(hairUp ? rules.fullBodyHairUp : rules.fullBody, hairUp ? rules.fullBody : rules.fullBodyHairUp);
      break;
    }
    case 'three_quarter':
      add(rules.threeQuarter, rules.fullBody);
      break;
    case 'back':
      add(rules.backView);
      break;
    case 'medium':
      add(rules.medium);
      break;
    case 'closeup':
    case 'hands':
      add(rules.closeUp);
      break;
  }
  return plan;
}

function sortRefs(refs: RefCandidate[]): RefCandidate[] {
  return [...refs].sort((a, b) => a.sortOrder - b.sortOrder);
}

function ext(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot) : '.jpg';
}

/**
 * Picks and orders the images to attach in Higgsfield: the influencer's references first
 * (anchor always first), then product images by relevance, within the tool's reference limit.
 */
export function selectAttachments(input: SelectionInput): Selection {
  const missing: string[] = [];
  const notes: string[] = [];
  const first = input.influencerName.split(' ')[0] || input.influencerName;
  const refs = sortRefs(input.references);

  // People
  const people: Array<{ ref: RefCandidate; tag: RefTag }> = [];
  for (const alternatives of personTagPlan(input)) {
    const found = alternatives
      .map((tag) => ({ tag, ref: refs.find((r) => r.tags.includes(tag) && !people.some((p) => p.ref.id === r.id)) }))
      .find((x) => x.ref);
    if (found?.ref) {
      people.push({ ref: found.ref, tag: found.tag });
      if (found.tag !== alternatives[0]) notes.push(`No "${alternatives[0]}" reference; using "${found.tag}" instead.`);
    } else {
      missing.push(`No "${alternatives[0]}" reference for ${first} yet`);
    }
  }

  // Products
  const products: ProductCandidate[] = [];
  if (input.showsProduct) {
    const backAllowed = input.shotKind === 'back' || !input.rules.backProductImageOnlyForBackView;
    const roleOrder = [...new Set([...input.productRoles, ...DEFAULT_ROLE_ORDER])].filter(
      (role) => role !== 'back' || backAllowed,
    );
    for (const role of roleOrder) {
      products.push(...input.products.filter((p) => p.role === role).sort((a, b) => a.order - b.order));
    }
    if (products.length === 0) missing.push('No product images uploaded');
  }

  // Fit the limit: anchor, the best product image and the background first, then the rest by priority.
  const limit = Math.max(1, input.maxRefs);
  const keepPeople = people.slice(0, 1);
  const keepProducts = products.slice(0, 1);
  const extraPeople = people.slice(1);
  const extraProducts = products.slice(1);
  const fits = limit - keepPeople.length - keepProducts.length > 0;
  const pose = input.pose && fits ? input.pose : null;
  if (input.pose && !pose) notes.push(`Left out the pose reference to stay within ${limit} images.`);
  const background = !input.pose && input.background && fits ? input.background : null;
  if (!input.pose && input.background && !background) notes.push(`Left out the background to stay within ${limit} images.`);
  let room = limit - keepPeople.length - keepProducts.length - (background || pose ? 1 : 0);
  while (room > 0 && extraPeople.length) {
    keepPeople.push(extraPeople.shift()!);
    room--;
  }
  while (room > 0 && extraProducts.length) {
    keepProducts.push(extraProducts.shift()!);
    room--;
  }
  const dropped = [...extraPeople.map((p) => `${first} ${p.tag}`), ...extraProducts.map((p) => `product ${p.role}`)];
  if (dropped.length) notes.push(`Left out to stay within ${limit} images: ${dropped.join(', ')}.`);

  const slug = slugify(first);
  const roleCount = new Map<string, number>();
  const attachments: SelectedAttachment[] = [];
  for (const { ref, tag } of keepPeople) {
    const index = attachments.length + 1;
    attachments.push({
      index,
      kind: 'reference',
      id: ref.id,
      path: ref.path,
      label: `${first} ${tag.replaceAll('_', ' ')}`,
      fileName: `${index}_${slug}_${tag}${ext(ref.path)}`,
    });
  }
  for (const product of keepProducts) {
    const index = attachments.length + 1;
    const n = (roleCount.get(product.role) ?? 0) + 1;
    roleCount.set(product.role, n);
    const suffix = n > 1 ? `_${n}` : '';
    attachments.push({
      index,
      kind: 'product',
      id: product.id,
      path: product.path,
      label: `Product ${product.role}${n > 1 ? ` ${n}` : ''}`,
      fileName: `${index}_product_${product.role}${suffix}${ext(product.path)}`,
    });
  }

  let backgroundIndex: number | null = null;
  if (background) {
    backgroundIndex = attachments.length + 1;
    attachments.push({
      index: backgroundIndex,
      kind: 'reference',
      id: background.id,
      path: background.path,
      label: 'Background (her room)',
      fileName: `${backgroundIndex}_background${ext(background.path)}`,
    });
  }

  let poseIndex: number | null = null;
  if (pose) {
    poseIndex = attachments.length + 1;
    attachments.push({
      index: poseIndex,
      kind: 'asset',
      id: pose.id,
      path: pose.path,
      label: 'Pose reference (before still)',
      fileName: `${poseIndex}_pose_before${ext(pose.path)}`,
    });
  }

  return { attachments, personCount: keepPeople.length, backgroundIndex, poseIndex, productCount: keepProducts.length, missing, notes };
}
