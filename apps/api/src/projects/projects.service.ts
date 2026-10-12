import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  PROJECT_STATUSES,
  ProductImagesUploadFieldsSchema,
  ProjectCreateFieldsSchema,
  advance,
  isStatusAtLeast,
  type ProductImageDto,
  type ProductImageRole,
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
import { projectInclude, toProductImageDto, toProjectDto, toProjectSummaryDto } from './project.mapper';

const status = z.enum(PROJECT_STATUSES);

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

  async create(files: Express.Multer.File[], fields: Record<string, unknown>): Promise<ProjectDto> {
    try {
      const data = parseOrThrow(ProjectCreateFieldsSchema, fields);
      if (!files?.length) throw new BadRequestException('Add at least one product image.');
      await this.assertRefs(data.influencerId, data.sourceId);
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));

      const { roles, ...projectData } = data;
      // Single-scene videos by default: Kling 3.0 only takes a start frame, so every scene starts from its own still.
      const project = await this.prisma.project.create({
        data: { ...projectData, videoMode: 'single', priceModeOverride: data.priceModeOverride ?? null },
      });
      await this.saveImages(project.id, files, infos, roles, 0);
      return this.get(project.id);
    } finally {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async update(id: string, data: ProjectUpdate): Promise<ProjectDto> {
    const current = await this.find(id);
    if (data.influencerId || data.sourceId) {
      await this.assertRefs(data.influencerId ?? current.influencerId, data.sourceId ?? current.sourceId);
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

  async addImages(id: string, files: Express.Multer.File[], fields: Record<string, unknown>): Promise<ProductImageDto[]> {
    try {
      await this.find(id);
      if (!files?.length) throw new BadRequestException('Attach at least one image.');
      const { roles } = parseOrThrow(ProductImagesUploadFieldsSchema, fields);
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));
      const last = await this.prisma.productImage.aggregate({ where: { projectId: id }, _max: { order: true } });
      return await this.saveImages(id, files, infos, roles, (last._max.order ?? -1) + 1);
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
    const remaining = await this.prisma.productImage.count({ where: { projectId: image.projectId } });
    if (remaining <= 1) throw new BadRequestException('A project needs at least one product image.');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.path);
  }

  async reorderImages(id: string, ids: string[]): Promise<ProductImageDto[]> {
    const images = await this.prisma.productImage.findMany({ where: { projectId: id } });
    if (images.length !== ids.length || !images.every((i) => ids.includes(i.id))) {
      throw new BadRequestException('Send every image id of this project exactly once.');
    }
    await this.prisma.$transaction(ids.map((imageId, order) => this.prisma.productImage.update({ where: { id: imageId }, data: { order } })));
    return (await this.get(id)).productImages;
  }

  private async saveImages(
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

  private async assertRefs(influencerId: string, sourceId: string): Promise<void> {
    const [influencer, source] = await Promise.all([
      this.prisma.influencer.findUnique({ where: { id: influencerId } }),
      this.prisma.source.findUnique({ where: { id: sourceId } }),
    ]);
    if (!influencer) throw new BadRequestException('Influencer not found');
    if (influencer.status === 'archived') throw new BadRequestException(`${influencer.name} is archived.`);
    if (!source) throw new BadRequestException('Source not found');
  }
}
