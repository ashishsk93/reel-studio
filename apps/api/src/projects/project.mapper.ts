import { z } from 'zod';
import {
  PRICE_MODES,
  PRODUCT_IMAGE_ROLES,
  PROJECT_STATUSES,
  SOURCE_KEYS,
  VIDEO_MODES,
  priceLabel,
  type ProductImageDto,
  type ProjectDto,
  type ProjectSummaryDto,
} from '@reel/shared';
import type { Influencer, ProductImage, Project, ReferenceImage, Source } from '../generated/prisma/client';
import { readJson } from '../common/json';
import { refTags, sortReferences } from '../influencers/influencer.mapper';
import type { StorageService } from '../storage/storage.service';

export type ProjectWithRelations = Project & {
  influencer: Influencer & { references: ReferenceImage[] };
  source: Source;
  productImages: ProductImage[];
  _count?: { scenes: number };
};

export const projectInclude = {
  influencer: { include: { references: true } },
  source: true,
  productImages: true,
  _count: { select: { scenes: true } },
} as const;

export function sortProductImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => a.order - b.order);
}

export function toProductImageDto(image: ProductImage, storage: StorageService): ProductImageDto {
  return {
    id: image.id,
    path: image.path,
    url: storage.url(image.path)!,
    width: image.width,
    height: image.height,
    role: readJson(z.enum(PRODUCT_IMAGE_ROLES), image.role, 'other'),
    order: image.order,
  };
}

const status = z.enum(PROJECT_STATUSES);
const priceMode = z.enum(PRICE_MODES);

export function toProjectSummaryDto(p: ProjectWithRelations, storage: StorageService): ProjectSummaryDto {
  const images = sortProductImages(p.productImages);
  const cover = images.find((i) => i.role === 'front') ?? images[0];
  const anchor = sortReferences(p.influencer.references).find((r) => refTags(r).includes('anchor'));
  return {
    id: p.id,
    productTitle: p.productTitle,
    priceInr: p.priceInr,
    occasion: p.occasion,
    status: readJson(status, p.status, 'draft'),
    furthestStatus: readJson(status, p.furthestStatus, 'draft'),
    influencer: { id: p.influencer.id, name: p.influencer.name, anchorUrl: storage.url(anchor?.path) },
    source: {
      id: p.source.id,
      key: readJson(z.enum(SOURCE_KEYS), p.source.key, 'amazon'),
      displayName: p.source.displayName,
    },
    coverUrl: storage.url(cover?.path),
    sceneCount: p._count?.scenes ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    postedAt: p.postedAt?.toISOString() ?? null,
  };
}

export function effectivePriceMode(p: Project & { source: Source }) {
  return readJson(priceMode, p.priceModeOverride ?? p.source.priceMode, 'exact');
}

export function toProjectDto(p: ProjectWithRelations, storage: StorageService): ProjectDto {
  const mode = effectivePriceMode(p);
  return {
    ...toProjectSummaryDto(p, storage),
    priceModeOverride: p.priceModeOverride ? readJson(priceMode, p.priceModeOverride, 'exact') : null,
    priceMode: mode,
    priceLabel: priceLabel(p.priceInr, mode),
    productUrl: p.productUrl,
    affiliateLink: p.affiliateLink,
    videoMode: readJson(z.enum(VIDEO_MODES), p.videoMode, 'multi_shot'),
    productImages: sortProductImages(p.productImages).map((i) => toProductImageDto(i, storage)),
  };
}
