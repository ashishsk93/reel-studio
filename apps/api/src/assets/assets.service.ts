import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { REF_TAGS, type AssetDto, type ImagesStepDto, type JobDto } from '@reel/shared';
import type { Asset } from '../generated/prisma/client';
import { readJson } from '../common/json';
import { InfluencersService } from '../influencers/influencers.service';
import { toJobDto } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { inspectImage } from '../storage/uploads';
import { StoryboardService } from '../storyboard/storyboard.service';
import { VideoAssetsService } from '../video/video-assets.service';
import { toAssetDto, type AssetWithReviews } from './asset.mapper';
import { REVIEW_JOB, ReviewService } from './review.service';

export type AssetOwner = { sceneId: string } | { creatorTaskId: string };

const withReviews = { reviews: { orderBy: { createdAt: 'desc' } } } as const;

/** Generated images for scenes and character-creator frames: upload, approve, reject, delete. */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly storyboard: StoryboardService,
    private readonly influencers: InfluencersService,
    private readonly reviews: ReviewService,
    private readonly videos: VideoAssetsService,
  ) {}

  // ---------- reads ----------

  async imagesStep(projectId: string): Promise<ImagesStepDto> {
    const board = await this.storyboard.get(projectId);
    const scenes = await this.prisma.scene.findMany({
      where: { projectId },
      include: { assets: { include: withReviews, orderBy: { version: 'desc' } } },
    });
    const jobs = await this.reviewJobs(scenes.flatMap((s) => s.assets.map((a) => a.id)), projectId);
    const result = board.scenes.map((dto) => {
      const scene = scenes.find((s) => s.id === dto.id)!;
      return {
        scene: dto,
        assets: scene.assets.map((a) => toAssetDto(a, jobs.get(a.id), this.storage)),
        approvedAssetId: scene.approvedAssetId,
      };
    });
    return { scenes: result, approved: result.filter((s) => s.approvedAssetId).length, total: result.length };
  }

  async listFor(owner: AssetOwner): Promise<AssetDto[]> {
    const assets = await this.prisma.asset.findMany({ where: owner, include: withReviews, orderBy: { version: 'desc' } });
    const jobs = await this.reviewJobs(assets.map((a) => a.id), assets[0]?.projectId ?? null);
    return assets.map((a) => toAssetDto(a, jobs.get(a.id), this.storage));
  }

  async get(assetId: string): Promise<AssetDto> {
    const asset = await this.find(assetId);
    const jobs = await this.reviewJobs([asset.id], asset.projectId);
    return toAssetDto(asset, jobs.get(asset.id), this.storage);
  }

  /** Latest review job per asset (job payloads carry the asset id). */
  async reviewJobs(assetIds: string[], projectId: string | null) {
    const map = new Map<string, ReturnType<typeof toJobDto>>();
    if (assetIds.length === 0) return map;
    const jobs = await this.prisma.job.findMany({
      where: { type: REVIEW_JOB, projectId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    for (const job of jobs) {
      const assetId = readJson(z.object({ assetId: z.string() }), job.payload, { assetId: '' }).assetId;
      if (assetIds.includes(assetId) && !map.has(assetId)) map.set(assetId, toJobDto(job));
    }
    return map;
  }

  // ---------- upload ----------

  /** `sourcePrompt` is the prompt the images were generated from (defaults to the scene's current prompt). */
  async upload(owner: AssetOwner, files: Express.Multer.File[], sourcePrompt?: string): Promise<AssetDto[]> {
    try {
      if (!files?.length) throw new BadRequestException('Attach at least one image.');
      const { projectId, dir } = await this.ownerInfo(owner);
      const infos = await Promise.all(files.map((f) => inspectImage(f.path, f.originalname)));
      const last = await this.prisma.asset.aggregate({ where: owner, _max: { version: true } });
      let version = last._max.version ?? 0;
      const prompt = sourcePrompt ?? ('sceneId' in owner ? (await this.storyboard.sceneAttachments(owner.sceneId)).prompt : '');

      const created: Asset[] = [];
      for (const [i, file] of files.entries()) {
        version++;
        const rel = `${dir}/v${version}.${infos[i].ext}`;
        await this.storage.moveInto(file.path, rel);
        created.push(
          await this.prisma.asset.create({
            data: {
              ...owner,
              projectId,
              kind: 'image',
              version,
              path: rel,
              mime: `image/${infos[i].format}`,
              width: infos[i].width,
              height: infos[i].height,
              sourcePrompt: prompt,
            },
          }),
        );
      }

      if ('sceneId' in owner && projectId) await this.projects.reach(projectId, 'images_in_progress');
      if ('creatorTaskId' in owner) {
        await this.prisma.creatorTask.updateMany({
          where: { id: owner.creatorTaskId, status: { in: ['ready', 'locked', 'skipped'] } },
          data: { status: 'in_review' },
        });
      }
      for (const asset of created) await this.reviews.start(asset.id);
      return Promise.all(created.map((a) => this.get(a.id)));
    } finally {
      await Promise.all((files ?? []).map((f) => this.storage.discardTemp(f.path)));
    }
  }

  async startReview(assetId: string): Promise<JobDto> {
    const asset = await this.find(assetId);
    return asset.videoJobId ? this.videos.startReview(assetId) : this.reviews.start(assetId);
  }

  // ---------- decisions ----------

  /** One approved image per scene (or per character frame); approving another replaces it. */
  async approve(assetId: string): Promise<AssetDto> {
    const asset = await this.find(assetId);
    if (asset.videoJobId) {
      await this.videos.approve(assetId);
    } else if (asset.sceneId) {
      const sceneId = asset.sceneId;
      await this.prisma.$transaction([
        this.prisma.asset.updateMany({ where: { sceneId, status: 'approved', id: { not: assetId } }, data: { status: 'pending_review' } }),
        this.prisma.asset.update({ where: { id: assetId }, data: { status: 'approved' } }),
        this.prisma.scene.update({ where: { id: sceneId }, data: { approvedAssetId: assetId } }),
      ]);
      await this.checkAllApproved(asset.projectId!);
    } else if (asset.creatorTaskId) {
      const task = await this.prisma.creatorTask.findUniqueOrThrow({ where: { id: asset.creatorTaskId }, include: { influencer: true } });
      const tag = readJson(z.enum(REF_TAGS), task.tag, 'lifestyle');
      await this.influencers.promoteToReference({
        influencerId: task.influencerId,
        sourcePath: asset.path,
        width: asset.width,
        height: asset.height,
        tag,
        creatorTaskId: task.id,
        // A background's note is the room description the storyboard picks places by.
        note: tag === 'background' ? task.influencer.homeSetting : `Character creator, version ${asset.version}`,
      });
      await this.prisma.$transaction([
        this.prisma.asset.updateMany({
          where: { creatorTaskId: task.id, status: 'approved', id: { not: assetId } },
          data: { status: 'pending_review' },
        }),
        this.prisma.asset.update({ where: { id: assetId }, data: { status: 'approved' } }),
        this.prisma.creatorTask.update({ where: { id: task.id }, data: { status: 'approved' } }),
      ]);
    } else {
      throw new ConflictException('This asset has no scene or frame to approve it for.');
    }
    return this.get(assetId);
  }

  async reject(assetId: string): Promise<AssetDto> {
    const asset = await this.find(assetId);
    if (asset.videoJobId) {
      await this.videos.reject(assetId);
      return this.get(assetId);
    }
    await this.prisma.asset.update({ where: { id: assetId }, data: { status: 'rejected' } });
    if (asset.status === 'approved') await this.unapprove(asset);
    return this.get(assetId);
  }

  async remove(assetId: string): Promise<void> {
    const asset = await this.find(assetId);
    if (asset.videoJobId) return this.videos.remove(assetId);
    if (asset.status === 'approved') await this.unapprove(asset);
    await this.prisma.asset.delete({ where: { id: assetId } });
    await this.storage.remove(asset.path);
  }

  // ---------- helpers ----------

  private async unapprove(asset: Asset): Promise<void> {
    if (asset.sceneId) {
      await this.prisma.scene.updateMany({ where: { id: asset.sceneId, approvedAssetId: asset.id }, data: { approvedAssetId: null } });
    } else if (asset.creatorTaskId) {
      // The reference it produced goes too, so projects stop attaching a rejected face.
      await this.influencers.removeCreatorReference(asset.creatorTaskId);
      await this.prisma.creatorTask.update({ where: { id: asset.creatorTaskId }, data: { status: 'in_review' } });
    }
  }

  private async checkAllApproved(projectId: string): Promise<void> {
    const scenes = await this.prisma.scene.findMany({ where: { projectId }, select: { approvedAssetId: true } });
    if (scenes.length > 0 && scenes.every((s) => s.approvedAssetId)) await this.projects.reach(projectId, 'images_approved');
  }

  private async ownerInfo(owner: AssetOwner): Promise<{ projectId: string | null; dir: string }> {
    if ('sceneId' in owner) {
      const scene = await this.prisma.scene.findUnique({ where: { id: owner.sceneId } });
      if (!scene) throw new NotFoundException('Scene not found');
      return { projectId: scene.projectId, dir: `projects/${scene.projectId}/scenes/${scene.id}` };
    }
    const task = await this.prisma.creatorTask.findUnique({ where: { id: owner.creatorTaskId } });
    if (!task) throw new NotFoundException('Character frame not found');
    return { projectId: null, dir: `influencers/${task.influencerId}/creator/${task.id}` };
  }

  private async find(assetId: string): Promise<AssetWithReviews> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, include: withReviews });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
