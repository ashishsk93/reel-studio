import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { IMAGE_MODELS, PRODUCT_IMAGE_ROLES, type ImageModel, type LlmTask, type ProductSpecDto } from '@reel/shared';
import type { Asset, Influencer, ReferenceImage } from '../generated/prisma/client';
import { readJson } from '../common/json';
import { frameCard, type CreatorPersona, type FrameDef } from '../creator/creator-plan';
import { personaOf, refTags } from '../influencers/influencer.mapper';
import type { LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service';
import { SettingsService } from '../settings/settings.service';
import type { PromptPersona } from '../storyboard/prompt-builder';
import type { ProductCandidate, RefCandidate } from '../storyboard/reference-rules';
import { StoryboardService } from '../storyboard/storyboard.service';
import { editCandidates, type EditCandidate } from './edit-prompt';

/** Most images sent alongside the one under review. */
const MAX_COMPARE_IMAGES = 6;

export interface AssetContext {
  asset: Asset;
  kind: 'scene' | 'creator';
  projectId: string | null;
  influencerId: string;
  /** Scene id or creator task id. */
  ownerId: string;
  persona: PromptPersona & CreatorPersona;
  candidates: EditCandidate[];
  maxRefs: Record<ImageModel, number>;
  reviewTask: LlmTask;
  reviewPrompt: string;
  /** Stable system blocks (cached): persona, then the product for scenes. */
  contextBlocks: string[];
  /** Describes the scene or frame and the prompt that produced the image. */
  ownerText: string;
  /** Labelled reference and product images to compare with. */
  compareImages: LlmPart[];
  mustMatch: ProductSpecDto['mustMatch'];
  /** Must-match keys the review has to score (empty when the product isn't in frame). */
  mustMatchKeys: string[];
  expectedAspect: string;
  checkFaceZone: boolean;
  frame?: FrameDef;
}

type InfluencerWithRefs = Influencer & { references: ReferenceImage[] };

export function personaBlock(inf: InfluencerWithRefs): string {
  const p = personaOf(inf);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- none');
  return [
    `## The influencer: ${inf.name}, ${inf.age}, ${inf.city}`,
    `Identity: ${inf.identityBlock}`,
    '',
    'Signature details:',
    list(p.signatureDetails),
    '',
    'Forbidden features (must never appear):',
    list(p.forbiddenFeatures),
    '',
    'Conditional features (only under their rule):',
    list(p.conditionalFeatures.map((c) => `${c.feature}: ${c.rule}`)),
    '',
    `Her own clothes (home outfit): ${inf.homeOutfit}`,
  ].join('\n');
}

export function productBlock(spec: ProductSpecDto): string {
  return [
    '## The product',
    spec.garmentParagraph,
    '',
    'Must match (key: label, what correct looks like):',
    ...spec.mustMatch.map((m) => `- \`${m.key}\`: ${m.label}. ${m.expected}`),
    '',
    'Unknown (cannot be seen in the product photos; never ask for these):',
    ...(spec.unknowns.length ? spec.unknowns.map((u) => `- ${u}`) : ['- nothing']),
  ].join('\n');
}

function refCandidates(inf: InfluencerWithRefs): RefCandidate[] {
  return inf.references.map((r) => ({ id: r.id, tags: refTags(r), path: r.path, sortOrder: r.sortOrder }));
}

/** Everything a review or the assistant needs about an asset's owner (scene or character frame). */
@Injectable()
export class AssetContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storyboard: StoryboardService,
    private readonly product: ProductService,
    private readonly settings: SettingsService,
    private readonly prompts: PromptService,
  ) {}

  async forAsset(assetId: string): Promise<AssetContext> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.sceneId) return this.sceneContext(asset, asset.sceneId);
    if (asset.creatorTaskId) return this.creatorContext(asset, asset.creatorTaskId);
    throw new BadRequestException('Only scene images and character frames can be reviewed here.');
  }

  private async maxRefs(): Promise<Record<ImageModel, number>> {
    const tools = await this.settings.get('tools.image');
    return Object.fromEntries(IMAGE_MODELS.map((m) => [m, tools[m]?.maxRefs ?? 4])) as Record<ImageModel, number>;
  }

  private async sceneContext(asset: Asset, sceneId: string): Promise<AssetContext> {
    const { scene, attachments, prompt } = await this.storyboard.sceneAttachments(sceneId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: scene.projectId },
      include: { influencer: { include: { references: true } }, productImages: true },
    });
    const spec = await this.product.get(project.id);
    if (!spec) throw new BadRequestException('Run the product analysis first.');
    const inf = project.influencer;
    const first = inf.name.split(' ')[0];
    const refs = refCandidates(inf);
    const products: ProductCandidate[] = project.productImages.map((p) => ({
      id: p.id,
      role: readJson(z.enum(PRODUCT_IMAGE_ROLES), p.role, 'other'),
      order: p.order,
      path: p.path,
    }));

    // The anchor, the scene's own attachments, then other product images (detail first).
    const compare: Array<{ path: string; label: string; id: string }> = [];
    const add = (id: string, path: string, label: string) => {
      if (compare.length < MAX_COMPARE_IMAGES && !compare.some((c) => c.id === id)) compare.push({ id, path, label });
    };
    const anchor = refs.find((r) => r.tags.includes('anchor'));
    if (anchor) add(anchor.id, anchor.path, `Reference: ${first}'s anchor (her face)`);
    for (const a of attachments) {
      add(a.id, a.path, a.kind === 'reference' ? `Reference: ${a.label}` : `Product image (${a.label.replace(/^Product /, '')})`);
    }
    const productInFrame = scene.showsProduct || scene.outfitState === 'wearing_product';
    if (productInFrame) {
      const byRelevance = [...products].sort((a, b) => Number(b.role === 'detail') - Number(a.role === 'detail') || a.order - b.order);
      for (const p of byRelevance) if (p.role !== 'back' || scene.shotKind === 'back') add(p.id, p.path, `Product image (${p.role})`);
    }

    const ownerText = [
      `## Scene ${scene.order + 1} of the storyboard`,
      `Type: ${scene.type}. Purpose: ${scene.purpose}`,
      `Framing: ${scene.shotKind}. Setting: ${scene.setting}`,
      scene.outfitState === 'wearing_product'
        ? 'She should be wearing the product.'
        : `She should be in her own clothes (${inf.homeOutfit})${scene.showsProduct ? ', holding or showing the product' : ''}.`,
      `Product in frame: ${productInFrame ? 'yes' : 'no'}`,
      `Scene: ${scene.description}`,
      `On-screen text "${scene.onScreenText}" is added later as an overlay; the image itself must have no text.`,
      '',
      'The prompt that was used:',
      asset.sourcePrompt || prompt,
    ].join('\n');

    return {
      asset,
      kind: 'scene',
      projectId: project.id,
      influencerId: inf.id,
      ownerId: scene.id,
      persona: { ...inf, ...personaOf(inf) },
      candidates: editCandidates({ influencerName: inf.name, references: refs, products }),
      maxRefs: await this.maxRefs(),
      reviewTask: 'image_review',
      reviewPrompt: 'image-review',
      contextBlocks: [personaBlock(inf), productBlock(spec)],
      ownerText,
      compareImages: compare.map((c): LlmPart => ({ type: 'image', path: c.path, label: c.label })),
      mustMatch: spec.mustMatch,
      mustMatchKeys: productInFrame ? spec.mustMatch.map((m) => m.key) : [],
      expectedAspect: '9:16',
      checkFaceZone: true,
    };
  }

  private async creatorContext(asset: Asset, taskId: string): Promise<AssetContext> {
    const task = await this.prisma.creatorTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { influencer: { include: { references: true } } },
    });
    const inf = task.influencer;
    const persona = { ...inf, ...personaOf(inf) };
    // A frame is never compared with a reference it produced itself.
    const refs = refCandidates({ ...inf, references: inf.references.filter((r) => r.creatorTaskId !== task.id) });
    const card = frameCard(task, persona, refs, this.prompts);

    const ownerText = [
      `## Reference frame: ${task.tag}`,
      `Purpose: ${card.frame.purpose}`,
      `Requested framing: ${card.frame.framing(inf.name.split(' ')[0])}`,
      `Expected aspect ratio: ${card.frame.aspect}`,
      task.tag === 'anchor' ? 'This is the anchor: there is no earlier reference; judge it against the identity description.' : '',
      '',
      'The prompt that was used:',
      asset.sourcePrompt || card.prompt,
    ]
      .filter((l) => l !== '')
      .join('\n');

    return {
      asset,
      kind: 'creator',
      projectId: null,
      influencerId: inf.id,
      ownerId: task.id,
      persona,
      candidates: editCandidates({ influencerName: inf.name, references: refs, products: [] }),
      maxRefs: await this.maxRefs(),
      reviewTask: 'reference_review',
      reviewPrompt: 'reference-review',
      contextBlocks: [personaBlock(inf)],
      ownerText,
      compareImages: card.attachments.map((a): LlmPart => ({ type: 'image', path: a.path, label: `Reference: ${a.label}` })),
      mustMatch: [],
      mustMatchKeys: [],
      expectedAspect: card.frame.aspect,
      checkFaceZone: false,
      frame: card.frame,
    };
  }
}
