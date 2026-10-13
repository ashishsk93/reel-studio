import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  FORMATS,
  PROJECT_STATUSES,
  ProductCreateFieldsSchema,
  ProductImagesUploadFieldsSchema,
  ProjectCreateFieldsSchema,
  STORY_FORMATS,
  advance,
  isStatusAtLeast,
  type ProductDto,
  type ProductImageDto,
  type ProductImageRole,
  type ProductUpdate,
  type ProjectDto,
  type ProjectStatus,
  type ProjectSummaryDto,
  type ProjectUpdate,
} from '@reel/shared';
import { readJson } from '../common/json';
import { parseOrThrow } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { inspectImage } from '../storage/uploads';
import { projectInclude, sortProducts, toProductDto, toProductImageDto, toProjectDto, toProjectSummaryDto } from './project.mapper';

const status = z.enum(PROJECT_STATUSES);
const format = z.enum(STORY_FORMATS);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(): Promise<ProjectSummaryDto[]> {
    const rows = await this.prisma.project.findMany({ include: projectInclude, orderBy: { updatedAt: 'desc' } });
    return rows.map((r) => toProjectSummaryDto(r, this.storage));
  }

  async get(id: string): Promise<ProjectDto> {
    return toProjectDto(await this.find(id), this.storage);
  }

  async find(id: string) {
    const row = await this.prisma.project.findUnique({ where: { id }, include: projectInclude });
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  /** Multipart: project fields, `products` JSON (each with `imageCount`), `images` in product order, `roles`. */
  async create(files: Express.Multer.File[], fields: Record<string, unknown>): Promise<ProjectDto> {
    try {
      const data = parseOrThrow(ProjectCreateFieldsSchema, fields);
      const expected = data.products.reduce((n, p) => n + p.imageCount, 0);
      if (!files?.length) throw new BadRequestException('Add at least one photo for each product.');
      if (files.length !== expected) throw new BadRequestException(`Expected ${expected} photos for the products, got ${files.length}.`);
      await this.assertInfluencer(data.influencerId);
      await Promise.all(data.products.map((p) => this.assertSource(p.sourceId)));
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));

      // Single-scene videos: Kling 3.0 only takes a start frame, so every scene starts from its own still.
      const project = await this.prisma.project.create({
        data: { influencerId: data.influencerId, format: data.format, title: data.title, occasion: data.occasion, videoMode: 'single' },
      });
      let offset = 0;
      for (const [order, p] of data.products.entries()) {
        const { imageCount, ...fieldsOnly } = p;
        const product = await this.prisma.product.create({
          data: { ...fieldsOnly, priceModeOverride: p.priceModeOverride ?? null, projectId: project.id, order },
        });
        const slice = (from: number) => ({ files: files.slice(from, from + imageCount), infos: infos.slice(from, from + imageCount), roles: data.roles.slice(from, from + imageCount) });
        const part = slice(offset);
        await this.saveImages(product.id, project.id, part.files, part.infos, part.roles, 0);
        offset += imageCount;
      }
      return this.get(project.id);
    } finally {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async update(id: string, data: ProjectUpdate): Promise<ProjectDto> {
    const current = await this.find(id);
    if (data.influencerId) await this.assertInfluencer(data.influencerId);
    if (data.format && data.format !== current.format) {
      if ((current._count?.scenes ?? 0) > 0) throw new BadRequestException('Delete the storyboard before changing the format.');
      this.assertProductCount(data.format, current.products.length);
    }
    await this.prisma.project.update({ where: { id }, data });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.prisma.project.delete({ where: { id } });
    await this.storage.removeDir(`projects/${id}`);
  }

  /** Revisit any step reached before; data from later steps is kept. */
  async goto(id: string, to: ProjectStatus): Promise<ProjectDto> {
    const project = await this.find(id);
    const furthest = readJson(status, project.furthestStatus, 'draft');
    if (!isStatusAtLeast(furthest, to)) {
      throw new BadRequestException(`This project hasn't reached "${to}" yet.`);
    }
    await this.prisma.project.update({ where: { id }, data: { status: to } });
    return this.get(id);
  }

  /** Moves the project forward when a step completes (never backwards). */
  async reach(id: string, to: ProjectStatus): Promise<void> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const current = {
      status: readJson(status, project.status, 'draft'),
      furthestStatus: readJson(status, project.furthestStatus, 'draft'),
    };
    if (isStatusAtLeast(current.status, to)) return;
    await this.prisma.project.update({ where: { id }, data: advance(current, to) });
  }

  async markPosted(id: string, posted: boolean): Promise<ProjectDto> {
    await this.find(id);
    if (posted) await this.reach(id, 'posted');
    await this.prisma.project.update({ where: { id }, data: { postedAt: posted ? new Date() : null } });
    return this.get(id);
  }

  // ---------- products ----------

  async findProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { source: true, images: true, spec: { select: { id: true } } } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async productDto(productId: string): Promise<ProductDto> {
    const product = await this.findProduct(productId);
    const siblings = await this.prisma.product.findMany({ where: { projectId: product.projectId }, orderBy: { order: 'asc' }, select: { id: true } });
    return toProductDto(product, siblings.findIndex((s) => s.id === productId), this.storage);
  }

  /** Multipart: the product fields, its `images` and their `roles`. */
  async addProduct(projectId: string, files: Express.Multer.File[], fields: Record<string, unknown>): Promise<ProjectDto> {
    try {
      const project = await this.find(projectId);
      const rule = FORMATS[format.parse(project.format)];
      if (project.products.length >= rule.products.max) {
        throw new BadRequestException(`${rule.label} takes at most ${rule.products.max} product${rule.products.max > 1 ? 's' : ''}.`);
      }
      if (!files?.length) throw new BadRequestException('Add at least one photo of the product.');
      const { roles, ...data } = parseOrThrow(ProductCreateFieldsSchema, fields);
      await this.assertSource(data.sourceId);
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));
      const last = sortProducts(project.products).at(-1);
      const product = await this.prisma.product.create({
        data: { ...data, priceModeOverride: data.priceModeOverride ?? null, projectId, order: (last?.order ?? -1) + 1 },
      });
      await this.saveImages(product.id, projectId, files, infos, roles, 0);
      return this.get(projectId);
    } finally {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async updateProduct(productId: string, data: ProductUpdate): Promise<ProductDto> {
    await this.findProduct(productId);
    if (data.sourceId) await this.assertSource(data.sourceId);
    await this.prisma.product.update({ where: { id: productId }, data });
    return this.productDto(productId);
  }

  async removeProduct(productId: string): Promise<ProjectDto> {
    const product = await this.findProduct(productId);
    const project = await this.find(product.projectId);
    const rule = FORMATS[format.parse(project.format)];
    if (project.products.length <= rule.products.min) {
      throw new BadRequestException(`${rule.label} needs at least ${rule.products.min} product${rule.products.min > 1 ? 's' : ''}.`);
    }
    await this.prisma.product.delete({ where: { id: productId } });
    await Promise.all(product.images.map((i) => this.storage.remove(i.path)));
    return this.get(product.projectId);
  }

  async reorderProducts(projectId: string, ids: string[]): Promise<ProjectDto> {
    const products = await this.prisma.product.findMany({ where: { projectId } });
    if (products.length !== ids.length || !products.every((p) => ids.includes(p.id))) {
      throw new BadRequestException('Send every product id of this project exactly once.');
    }
    await this.prisma.$transaction(ids.map((id, order) => this.prisma.product.update({ where: { id }, data: { order } })));
    return this.get(projectId);
  }

  // ---------- product images ----------

  async addImages(productId: string, files: Express.Multer.File[], fields: Record<string, unknown>): Promise<ProductImageDto[]> {
    try {
      const product = await this.findProduct(productId);
      if (!files?.length) throw new BadRequestException('Attach at least one image.');
      const { roles } = parseOrThrow(ProductImagesUploadFieldsSchema, fields);
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));
      const last = await this.prisma.productImage.aggregate({ where: { productId }, _max: { order: true } });
      return await this.saveImages(productId, product.projectId, files, infos, roles, (last._max.order ?? -1) + 1);
    } finally {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async updateImage(imageId: string, role: ProductImageRole | undefined): Promise<ProductImageDto> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Product image not found');
    const updated = await this.prisma.productImage.update({ where: { id: imageId }, data: { role } });
    return toProductImageDto(updated, this.storage);
  }

  async deleteImage(imageId: string): Promise<void> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Product image not found');
    const remaining = await this.prisma.productImage.count({ where: { productId: image.productId } });
    if (remaining <= 1) throw new BadRequestException('A product needs at least one photo.');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.path);
  }

  async reorderImages(productId: string, ids: string[]): Promise<ProductImageDto[]> {
    const images = await this.prisma.productImage.findMany({ where: { productId } });
    if (images.length !== ids.length || !images.every((i) => ids.includes(i.id))) {
      throw new BadRequestException('Send every image id of this product exactly once.');
    }
    await this.prisma.$transaction(ids.map((imageId, order) => this.prisma.productImage.update({ where: { id: imageId }, data: { order } })));
    return (await this.productDto(productId)).images;
  }

  private async saveImages(
    productId: string,
    projectId: string,
    files: Express.Multer.File[],
    infos: Awaited<ReturnType<typeof inspectImage>>[],
    roles: ProductImageRole[],
    startOrder: number,
  ): Promise<ProductImageDto[]> {
    const created: ProductImageDto[] = [];
    for (const [i, file] of files.entries()) {
      const rel = `projects/${projectId}/product/${randomUUID()}.${infos[i].ext}`;
      await this.storage.moveInto(file.path, rel);
      const image = await this.prisma.productImage.create({
        data: {
          projectId,
          productId,
          path: rel,
          width: infos[i].width,
          height: infos[i].height,
          role: roles[i] ?? (startOrder + i === 0 ? 'front' : 'other'),
          order: startOrder + i,
        },
      });
      created.push(toProductImageDto(image, this.storage));
    }
    return created;
  }

  private assertProductCount(f: z.infer<typeof format>, count: number): void {
    const rule = FORMATS[f];
    if (count < rule.products.min || count > rule.products.max) {
      throw new BadRequestException(`${rule.label} takes ${rule.products.min}–${rule.products.max} products; this project has ${count}.`);
    }
  }

  private async assertInfluencer(influencerId: string): Promise<void> {
    const influencer = await this.prisma.influencer.findUnique({ where: { id: influencerId } });
    if (!influencer) throw new BadRequestException('Influencer not found');
    if (influencer.status === 'archived') throw new BadRequestException(`${influencer.name} is archived.`);
  }

  private async assertSource(sourceId: string): Promise<void> {
    if (!(await this.prisma.source.findUnique({ where: { id: sourceId } }))) throw new BadRequestException('Store not found');
  }
}
