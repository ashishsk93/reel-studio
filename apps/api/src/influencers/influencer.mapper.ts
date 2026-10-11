import { z } from 'zod';
import {
  ConditionalFeatureSchema,
  INFLUENCER_STATUSES,
  RefTagsSchema,
  type InfluencerDetailDto,
  type InfluencerDto,
  type ReferenceImageDto,
} from '@reel/shared';
import type { Influencer, ReferenceImage } from '../generated/prisma/client';
import { readJson } from '../common/json';
import type { StorageService } from '../storage/storage.service';

const strings = z.array(z.string());

export function sortReferences(refs: ReferenceImage[]): ReferenceImage[] {
  return [...refs].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
}

export function refTags(ref: ReferenceImage) {
  return readJson(RefTagsSchema, ref.tags, []);
}

export function toReferenceDto(ref: ReferenceImage, storage: StorageService): ReferenceImageDto {
  return {
    id: ref.id,
    influencerId: ref.influencerId,
    path: ref.path,
    url: storage.url(ref.path)!,
    width: ref.width,
    height: ref.height,
    tags: refTags(ref),
    note: ref.note,
    sortOrder: ref.sortOrder,
    createdAt: ref.createdAt.toISOString(),
  };
}

/** Parsed persona fields from the Json columns. */
export function personaOf(influencer: Influencer) {
  return {
    exampleLines: readJson(strings, influencer.exampleLines, []),
    signatureDetails: readJson(strings, influencer.signatureDetails, []),
    forbiddenFeatures: readJson(strings, influencer.forbiddenFeatures, []),
    conditionalFeatures: readJson(z.array(ConditionalFeatureSchema), influencer.conditionalFeatures, []),
  };
}

export function toInfluencerDto(
  influencer: Influencer & { references: ReferenceImage[] },
  storage: StorageService,
): InfluencerDto {
  const refs = sortReferences(influencer.references);
  const anchor = refs.find((r) => refTags(r).includes('anchor')) ?? null;
  return {
    id: influencer.id,
    slug: influencer.slug,
    name: influencer.name,
    age: influencer.age,
    city: influencer.city,
    identityBlock: influencer.identityBlock,
    shortIdentity: influencer.shortIdentity,
    voiceNotes: influencer.voiceNotes,
    personality: influencer.personality,
    lane: influencer.lane,
    hashtag: influencer.hashtag,
    defaultStyling: influencer.defaultStyling,
    homeOutfit: influencer.homeOutfit,
    homeSetting: influencer.homeSetting,
    status: readJson(z.enum(INFLUENCER_STATUSES), influencer.status, 'active'),
    createdAt: influencer.createdAt.toISOString(),
    updatedAt: influencer.updatedAt.toISOString(),
    ...personaOf(influencer),
    anchor: anchor ? toReferenceDto(anchor, storage) : null,
    referenceCount: refs.length,
  };
}

export function toInfluencerDetailDto(
  influencer: Influencer & { references: ReferenceImage[] },
  storage: StorageService,
): InfluencerDetailDto {
  return {
    ...toInfluencerDto(influencer, storage),
    references: sortReferences(influencer.references).map((r) => toReferenceDto(r, storage)),
    creatorBrief: (influencer.creatorBrief as Record<string, unknown> | null) ?? null,
  };
}
