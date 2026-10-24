import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { InstagramPublishSchema, sourceDefinition, type InstagramPostDto, type InstagramProjectDto, type JobDto } from '@reel/shared';
import type { InstagramPost } from '../generated/prisma/client';
import { parseOrThrow } from '../common/zod';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InstagramService } from './instagram.service';
import { mediaSignature } from './webhook';

export const PUBLISH_JOB = 'instagram.publish';
/** Files Instagram may fetch through a signed link. */
export const PUBLIC_RENDER_FILES = ['final.mp4', 'cover_titled.jpg', 'cover.jpg'] as const;

const PublishPayload = z.object({
  postId: z.string(),
  shareToFeed: z.boolean(),
  dmText: z.string().nullable(),
});

const LINK_TTL_S = 3 * 60 * 60;
const STATUS_POLL_MS = 5000;
const PROCESSING_TIMEOUT_MS = 20 * 60 * 1000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('Cancelled'))), { once: true });
  });

/**
 * Publishes a render as a Reel: Instagram fetches final.mp4 (and the cover) from a signed,
 * short-lived PUBLIC_URL link, processes it, then we publish, add the first comment and
 * set the Reel's DM.
 */
@Injectable()
export class PublishService implements OnModuleInit {
  private readonly logger = new Logger('InstagramPublish');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly instagram: InstagramService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: PUBLISH_JOB,
      group: 'media',
      payload: PublishPayload,
      // Never retried automatically: a retry after a lost response could post twice.
      maxAttempts: 1,
      run: async (payload, ctx) => {
        try {
          return await this.run(payload, ctx.signal, (f, m) => ctx.progress(f, m));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.prisma.instagramPost.update({ where: { id: payload.postId }, data: { status: 'failed', error: message.slice(0, 500) } });
          throw error;
        }
      },
    });
  }

  /** Defaults for the publish form and earlier attempts for this project. */
  async forProject(projectId: string): Promise<InstagramProjectDto> {
    const [posts, captions, products] = await Promise.all([
      this.prisma.instagramPost.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.captionPackage.findUnique({ where: { projectId } }),
      this.prisma.product.findMany({ where: { projectId }, select: { source: { select: { key: true } } } }),
    ]);
    const status = await this.instagram.status();
    return {
      posts: posts.map(toDto),
      ready: { connected: status.connected, publicUrl: Boolean(status.publicUrl), secret: status.configured },
      defaults: {
        caption: captions?.caption ?? '',
        firstComment: captions?.firstComment ?? null,
        dmText: captions?.dmTemplate ?? '',
        keyword: status.keyword,
      },
      otherAppReplies: products.some((p) => sourceDefinition(p.source.key)?.appSendsDmLink === true),
    };
  }

  async start(projectId: string, body: unknown): Promise<JobDto> {
    const input = parseOrThrow(InstagramPublishSchema, body);
    const status = await this.instagram.status();
    if (!status.connected) throw new BadRequestException('Connect your Instagram account first (Instagram page).');
    if (!status.publicUrl) throw new BadRequestException('Set PUBLIC_URL in .env: Instagram downloads the video from that address, so it has to be reachable from the internet.');
    if (!status.configured) throw new BadRequestException('Set INSTAGRAM_APP_SECRET in .env: it signs the temporary video link.');

    const render = await this.prisma.render.findUnique({ where: { id: input.renderId } });
    if (!render || render.projectId !== projectId) throw new NotFoundException('Render not found');
    if (render.status !== 'succeeded' || !(await this.storage.exists(`${render.outputDir}/final.mp4`))) {
      throw new BadRequestException('That render has no final.mp4; render the Reel first.');
    }
    const inFlight = await this.prisma.instagramPost.findFirst({ where: { projectId, status: { in: ['queued', 'uploading', 'processing'] } } });
    if (inFlight) throw new ConflictException('This Reel is already being published.');

    const post = await this.prisma.instagramPost.create({
      data: { projectId, renderId: render.id, status: 'queued', caption: input.caption, firstComment: input.firstComment },
    });
    return this.jobs.enqueue(PUBLISH_JOB, { postId: post.id, shareToFeed: input.shareToFeed, dmText: input.dmText }, { projectId, idempotencyKey: `${PUBLISH_JOB}:${post.id}` });
  }

  /** Public, time-limited URL Instagram can download a render file from. */
  signedUrl(renderId: string, file: (typeof PUBLIC_RENDER_FILES)[number]): string {
    const expires = Math.floor(Date.now() / 1000) + LINK_TTL_S;
    const sig = mediaSignature(this.instagram.appSecret, renderId, file, expires);
    return `${this.instagram.publicUrl}/api/instagram/media/${renderId}/${expires}/${sig}/${file}`;
  }

  private async run(
    payload: z.output<typeof PublishPayload>,
    signal: AbortSignal,
    progress: (f: number, m: string) => Promise<void>,
  ): Promise<{ postId: string; permalink: string | null }> {
    let post = await this.prisma.instagramPost.findUniqueOrThrow({ where: { id: payload.postId } });
    if (post.status === 'published') return { postId: post.id, permalink: post.permalink };
    const { client, account } = await this.instagram.client();
    const render = await this.prisma.render.findUniqueOrThrow({ where: { id: post.renderId } });

    if (!post.containerId) {
      await progress(0.05, 'Sending the video to Instagram');
      let coverUrl: string | undefined;
      for (const file of ['cover_titled.jpg', 'cover.jpg'] as const) {
        if (await this.storage.exists(`${render.outputDir}/${file}`)) {
          coverUrl = this.signedUrl(render.id, file);
          break;
        }
      }
      const container = await client.createReelContainer(account.igUserId, {
        videoUrl: this.signedUrl(render.id, 'final.mp4'),
        caption: post.caption,
        shareToFeed: payload.shareToFeed,
        coverUrl,
      });
      post = await this.prisma.instagramPost.update({ where: { id: post.id }, data: { containerId: container.id, status: 'processing' } });
    }

    const started = Date.now();
    for (;;) {
      const s = await client.containerStatus(post.containerId!);
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'PUBLISHED') throw new Error('Instagram says this upload was already published. Check your profile before trying again.');
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram couldn't process the video: ${s.status ?? s.status_code}`);
      if (Date.now() - started > PROCESSING_TIMEOUT_MS) throw new Error('Instagram is still processing after 20 minutes; try again later.');
      const elapsed = (Date.now() - started) / PROCESSING_TIMEOUT_MS;
      await progress(0.1 + Math.min(0.7, elapsed * 4), 'Instagram is processing the video');
      await sleep(STATUS_POLL_MS, signal);
    }

    await progress(0.85, 'Publishing');
    const published = await client.publish(account.igUserId, post.containerId!);
    const media = await client.media(published.id).catch(() => null);
    post = await this.prisma.instagramPost.update({
      where: { id: post.id },
      data: { status: 'published', mediaId: published.id, permalink: media?.permalink ?? null, publishedAt: new Date(), error: null },
    });
    await this.prisma.project.update({ where: { id: post.projectId }, data: { postedAt: new Date() } });

    const warnings: string[] = [];
    if (post.firstComment) {
      await progress(0.92, 'Adding the first comment');
      await client.comment(published.id, post.firstComment).catch((e: unknown) => warnings.push(`First comment failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (payload.dmText) await this.instagram.setReelDm(published.id, { dmText: payload.dmText }, post.projectId);
    if (warnings.length) await this.prisma.instagramPost.update({ where: { id: post.id }, data: { error: warnings.join(' · ') } });
    this.logger.log(`Published ${post.permalink ?? published.id}`);
    return { postId: post.id, permalink: post.permalink };
  }
}

function toDto(p: InstagramPost): InstagramPostDto {
  return {
    id: p.id,
    projectId: p.projectId,
    renderId: p.renderId,
    status: p.status as InstagramPostDto['status'],
    mediaId: p.mediaId,
    permalink: p.permalink,
    error: p.error,
    createdAt: p.createdAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
  };
}
