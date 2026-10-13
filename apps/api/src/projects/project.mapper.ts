import { z } from 'zod';
import {
  PRICE_MODES,
  PRODUCT_IMAGE_ROLES,
  PROJECT_STATUSES,
  SOURCE_KEYS,
  STORY_FORMATS,
  VIDEO_MODES,
  priceLabel,
  type ProductDto,
  type ProductImageDto,
  type ProjectDto,
  type ProjectSummaryDto,
} from '@reel/shared';
import type { Influencer, Product, ProductImage, ProductSpec, Project, ReferenceImage, Source } from '../generated/prisma/client';
import { readJson } from '../common/json';
import { refTags, sortReferences } from '../influencers/influencer.mapper';
import type { StorageService } from '../storage/storage.service';

export type ProductWithRelations = Product & { source: Source; images: ProductImage[]; spec: Pick<ProductSpec, 'id'> | null };

export type ProjectWithRelations = Project & {
  influencer: Influencer & { references: ReferenceImage[] };
  products: ProductWithRelations[];
  _count?: { scenes: number };
};

export const projectInclude = {
  influencer: { include: { references: true } },
  products: { include: { source: true, images: true, spec: { select: { id: true } } }, orderBy: { order: 'asc' } },
  _count: { select: { scenes: true } },
} as const;

export function sortProductImages<T extends { order: number }>(images: T[]): T[] {
  return [...images].sort((a, b) => a.order - b.order);
}

export function sortProducts<T extends { order: number }>(products: T[]): T[] {
  return [...products].sort((a, b) => a.order - b.order);
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

/** The price mode used for a product's badge: its override, or its store's mode. */
export function effectivePriceMode(p: Pick<Product, 'priceModeOverride'> & { source: Source }) {
  return readJson(priceMode, p.priceModeOverride ?? p.source.priceMode, 'exact');
}

export function productPriceLabel(p: Pick<Product, 'priceModeOverride' | 'priceInr'> & { source: Source }): string | null {
  return priceLabel(p.priceInr, effectivePriceMode(p));
}

export function toProductDto(p: ProductWithRelations, index: number, storage: StorageService): ProductDto {
  const mode = effectivePriceMode(p);
  return {
    id: p.id,
    number: index + 1,
    title: p.title,
    note: p.note,
    source: {
      id: p.source.id,
      key: readJson(z.enum(SOURCE_KEYS), p.source.key, 'amazon'),
      displayName: p.source.displayName,
      logoUrl: storage.url(p.source.logoPath),
    },
    priceInr: p.priceInr,
    priceModeOverride: p.priceModeOverride ? readJson(priceMode, p.priceModeOverride, 'exact') : null,
    priceMode: mode,
    priceLabel: priceLabel(p.priceInr, mode),
    productUrl: p.productUrl,
    affiliateLink: p.affiliateLink,
    images: sortProductImages(p.images).map((i) => toProductImageDto(i, storage)),
    analyzed: Boolean(p.spec),
  };
}

export function toProjectSummaryDto(p: ProjectWithRelations, storage: StorageService): ProjectSummaryDto {
  const products = sortProducts(p.products);
  const first = products[0];
  const images = first ? sortProductImages(first.images) : [];
  const cover = images.find((i) => i.role === 'front') ?? images[0];
  const anchor = sortReferences(p.influencer.references).find((r) => refTags(r).includes('anchor'));
  const prices = products.map((x) => x.priceInr);
  const sources = [...new Map(products.map((x) => [x.source.id, x.source])).values()];
  return {
    id: p.id,
    format: readJson(z.enum(STORY_FORMATS), p.format, 'classic'),
    title: p.title,
    occasion: p.occasion,
    status: readJson(status, p.status, 'draft'),
    furthestStatus: readJson(status, p.furthestStatus, 'draft'),
    influencer: { id: p.influencer.id, name: p.influencer.name, anchorUrl: storage.url(anchor?.path) },
    productCount: products.length,
    priceRange: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
    sources: sources.map((s) => ({ id: s.id, key: readJson(z.enum(SOURCE_KEYS), s.key, 'amazon'), displayName: s.displayName })),
    coverUrl: storage.url(cover?.path),
    sceneCount: p._count?.scenes ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    postedAt: p.postedAt?.toISOString() ?? null,
  };
}

export function toProjectDto(p: ProjectWithRelations, storage: StorageService): ProjectDto {
  return {
    ...toProjectSummaryDto(p, storage),
    videoMode: readJson(z.enum(VIDEO_MODES), p.videoMode, 'single'),
    products: sortProducts(p.products).map((x, i) => toProductDto(x, i, storage)),
  };
}
