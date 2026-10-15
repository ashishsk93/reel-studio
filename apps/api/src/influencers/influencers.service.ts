import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ReferenceUploadFieldsSchema,
  type InfluencerCreateSchema,
  type InfluencerDetailDto,
  type InfluencerDto,
  type InfluencerUpdate,
  type PromptCardDto,
  type ReferenceImageDto,
  type ReferenceImageUpdate,
  type RefTag,
} from '@reel/shared';
import type { z } from 'zod';
import { parseOrThrow } from '../common/zod';
import { toJson } from '../common/json';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { inspectImage, upscaleIfSmall } from '../storage/uploads';
import {
  personaOf,
  refTags,
  toInfluencerDetailDto,
  toInfluencerDto,
  toReferenceDto,
} from './influencer.mapper';
import { slugify } from './persona-text';
import { buildSamplePrompt } from './sample-prompt';

type InfluencerCreate = z.output<typeof InfluencerCreateSchema>;

const withRefs = { references: true } as const;

@Injectable()
export class InfluencersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
  ) {}

  async list(): Promise<InfluencerDto[]> {
    const rows = await this.prisma.influencer.findMany({ include: withRefs, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => toInfluencerDto(row, this.storage));
  }

  async get(id: string): Promise<InfluencerDetailDto> {
    return toInfluencerDetailDto(await this.find(id), this.storage);
  }

  async create(data: InfluencerCreate, creatorBrief?: unknown): Promise<InfluencerDetailDto> {
    const slug = await this.uniqueSlug(data.slug ?? slugify(data.name));
    const row = await this.prisma.influencer.create({
      data: {
        ...data,
        slug,
        exampleLines: toJson(data.exampleLines),
        signatureDetails: toJson(data.signatureDetails),
        forbiddenFeatures: toJson(data.forbiddenFeatures),
        conditionalFeatures: toJson(data.conditionalFeatures),
        creatorBrief: creatorBrief === undefined ? undefined : toJson(creatorBrief),
      },
      include: withRefs,
    });
    return toInfluencerDetailDto(row, this.storage);
  }

  async update(id: string, data: InfluencerUpdate): Promise<InfluencerDetailDto> {
    const current = await this.find(id);
    if (data.status === 'active') this.assertCanActivate(current.references);
    const slug = data.slug && data.slug !== current.slug ? await this.uniqueSlug(data.slug, id) : undefined;
    const row = await this.prisma.influencer.update({
      where: { id },
      data: {
        ...data,
        slug,
        exampleLines: data.exampleLines ? toJson(data.exampleLines) : undefined,
        signatureDetails: data.signatureDetails ? toJson(data.signatureDetails) : undefined,
        forbiddenFeatures: data.forbiddenFeatures ? toJson(data.forbiddenFeatures) : undefined,
        conditionalFeatures: data.conditionalFeatures ? toJson(data.conditionalFeatures) : undefined,
      },
      include: withRefs,
    });
    return toInfluencerDetailDto(row, this.storage);
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    const projects = await this.prisma.project.count({ where: { influencerId: id } });
    if (projects > 0) {
      throw new ConflictException(`This influencer is used by ${projects} project(s). Archive her instead.`);
    }
    await this.prisma.influencer.delete({ where: { id } });
    await this.storage.removeDir(`influencers/${id}`);
  }

  async activate(id: string): Promise<InfluencerDetailDto> {
    return this.update(id, { status: 'active' });
  }

  async addReferences(
    id: string,
    files: Express.Multer.File[],
    fields: Record<string, unknown>,
  ): Promise<ReferenceImageDto[]> {
    try {
      await this.find(id);
      if (!files?.length) throw new BadRequestException('Attach at least one image.');
      const { tags, note } = parseOrThrow(ReferenceUploadFieldsSchema, fields);
      if (tags.includes('anchor') && files.length > 1) {
        throw new BadRequestException('Upload the anchor image on its own: there is only one anchor.');
      }

      const infos = await Promise.all(files.map(async (f) => upscaleIfSmall(f.path, await inspectImage(f.path, f.originalname))));
      const last = await this.prisma.referenceImage.aggregate({ where: { influencerId: id }, _max: { sortOrder: true } });
      let order = (last._max.sortOrder ?? -1) + 1;

      if (tags.includes('anchor')) await this.stripTag(id, 'anchor');
      const created: ReferenceImageDto[] = [];
      for (const [i, file] of files.entries()) {
        const rel = `influencers/${id}/refs/${randomUUID()}.${infos[i].ext}`;
        await this.storage.moveInto(file.path, rel);
        const ref = await this.prisma.referenceImage.create({
          data: {
            influencerId: id,
            path: rel,
            width: infos[i].width,
            height: infos[i].height,
            tags: toJson(tags),
            note,
            sortOrder: order++,
          },
        });
        created.push(toReferenceDto(ref, this.storage));
      }
      return created;
    } finally {
      // Anything not moved into place (validation failure) is cleaned up here.
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async updateReference(refId: string, data: ReferenceImageUpdate): Promise<ReferenceImageDto> {
    const ref = await this.prisma.referenceImage.findUnique({ where: { id: refId } });
    if (!ref) throw new NotFoundException('Reference image not found');
    if (data.tags?.includes('anchor') && !refTags(ref).includes('anchor')) {
      await this.stripTag(ref.influencerId, 'anchor');
    }
    const updated = await this.prisma.referenceImage.update({
      where: { id: refId },
      data: {
        tags: data.tags ? toJson([...new Set(data.tags)]) : undefined,
        note: data.note,
        sortOrder: data.sortOrder,
      },
    });
    return toReferenceDto(updated, this.storage);
  }

  async deleteReference(refId: string): Promise<void> {
    const ref = await this.prisma.referenceImage.findUnique({ where: { id: refId } });
    if (!ref) throw new NotFoundException('Reference image not found');
    await this.prisma.referenceImage.delete({ where: { id: refId } });
    await this.storage.remove(ref.path);
  }

  /**
   * Character creator: an approved frame becomes a tagged reference. The file is copied, so
   * deleting the upload later keeps the reference. Re-approving a frame replaces its reference.
   */
  async promoteToReference(input: {
    influencerId: string;
    sourcePath: string;
    width: number;
    height: number;
    tag: RefTag;
    creatorTaskId: string;
    note: string;
  }): Promise<ReferenceImageDto> {
    await this.removeCreatorReference(input.creatorTaskId);
    if (input.tag === 'anchor') await this.stripTag(input.influencerId, 'anchor');
    const dot = input.sourcePath.lastIndexOf('.');
    const rel = `influencers/${input.influencerId}/refs/${randomUUID()}${dot >= 0 ? input.sourcePath.slice(dot) : '.jpg'}`;
    await this.storage.copyInto(input.sourcePath, rel);
    const order = await this.prisma.referenceImage.aggregate({
      where: { influencerId: input.influencerId },
      _max: { sortOrder: true },
      _min: { sortOrder: true },
    });
    const ref = await this.prisma.referenceImage.create({
      data: {
        influencerId: input.influencerId,
        path: rel,
        width: input.width,
        height: input.height,
        tags: toJson([input.tag]),
        note: input.note,
        // The anchor goes first in the gallery; everything else is appended.
        sortOrder: input.tag === 'anchor' ? (order._min.sortOrder ?? 0) - 1 : (order._max.sortOrder ?? -1) + 1,
        creatorTaskId: input.creatorTaskId,
      },
    });
    return toReferenceDto(ref, this.storage);
  }

  async removeCreatorReference(creatorTaskId: string): Promise<void> {
    const previous = await this.prisma.referenceImage.findUnique({ where: { creatorTaskId } });
    if (!previous) return;
    await this.prisma.referenceImage.delete({ where: { id: previous.id } });
    await this.storage.remove(previous.path);
  }

  async samplePrompt(id: string): Promise<PromptCardDto> {
    const influencer = await this.find(id);
    const [rules, tools] = await Promise.all([this.settings.get('storyboard.refRules'), this.settings.get('tools.image')]);
    return buildSamplePrompt({ ...influencer, ...personaOf(influencer) }, influencer.references, {
      prompts: this.prompts,
      rules,
      maxRefs: Math.min(...Object.values(tools).map((t) => t.maxRefs)),
      fileUrl: (rel) => this.storage.url(rel),
    });
  }

  private async find(id: string) {
    const row = await this.prisma.influencer.findUnique({ where: { id }, include: withRefs });
    if (!row) throw new NotFoundException('Influencer not found');
    return row;
  }

  private assertCanActivate(references: Parameters<typeof refTags>[0][]): void {
    if (!references.some((r) => refTags(r).includes('anchor'))) {
      throw new BadRequestException('Upload an anchor reference image before activating this influencer.');
    }
  }

  /** The anchor is exclusive: tagging a new one removes the tag from the old one. */
  private async stripTag(influencerId: string, tag: RefTag): Promise<void> {
    const refs = await this.prisma.referenceImage.findMany({ where: { influencerId } });
    for (const ref of refs) {
      const tags = refTags(ref);
      if (tags.includes(tag)) {
        await this.prisma.referenceImage.update({
          where: { id: ref.id },
          data: { tags: toJson(tags.filter((t) => t !== tag)) },
        });
      }
    }
  }

  private async uniqueSlug(base: string, exceptId?: string): Promise<string> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const existing = await this.prisma.influencer.findUnique({ where: { slug } });
      if (!existing || existing.id === exceptId) return slug;
    }
  }
}
