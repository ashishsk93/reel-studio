import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { InstagramAccountUpdate, InstagramReelDto, InstagramReplyDto, InstagramStatusDto } from '@reel/shared';
import { InstagramReelDmSchema } from '@reel/shared';
import type { InstagramAccount } from '../generated/prisma/client';
import { parseOrThrow } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { GraphClient, GraphError } from './graph';

const ACCOUNT_ID = 'me';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Refresh when fewer than this many days are left (tokens last 60). */
const REFRESH_WITHIN_DAYS = 20;
const REFRESH_CHECK_MS = 6 * 60 * 60 * 1000;
/** Reply-log status for comments that were already on a Reel when its DM was set; hidden from the activity list. */
const SKIPPED_EXISTING = 'existing';

/** The connected account, its token, the shared reply settings and each Reel's DM. */
@Injectable()
export class InstagramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Instagram');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.refreshIfDue(), REFRESH_CHECK_MS);
    this.timer.unref();
    setTimeout(() => void this.refreshIfDue(), 10_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  get publicUrl(): string {
    return this.config.publicUrl;
  }

  get appSecret(): string {
    return this.config.instagram.appSecret;
  }

  async account(): Promise<InstagramAccount> {
    return this.prisma.instagramAccount.upsert({ where: { id: ACCOUNT_ID }, create: { id: ACCOUNT_ID }, update: {} });
  }

  async status(): Promise<InstagramStatusDto> {
    const a = await this.account();
    const pub = this.config.publicUrl || null;
    return {
      configured: Boolean(this.config.instagram.appSecret),
      publicUrl: pub,
      webhookUrl: pub ? `${pub}/api/instagram/webhook` : null,
      verifyTokenSet: Boolean(this.config.instagram.verifyToken),
      connected: Boolean(a.accessToken),
      username: a.username,
      igUserId: a.igUserId,
      tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
      autoReply: a.autoReply,
      poll: a.poll,
      keyword: a.keyword,
      commentReply: a.commentReply,
      lastWebhookAt: a.lastWebhookAt?.toISOString() ?? null,
      lastPollAt: a.lastPollAt?.toISOString() ?? null,
      lastError: a.lastError,
    };
  }

  /** Graph client for the connected account; throws a readable error when there's none. */
  async client(): Promise<{ client: GraphClient; account: InstagramAccount & { accessToken: string; igUserId: string } }> {
    const account = await this.account();
    if (!account.accessToken || !account.igUserId) throw new BadRequestException('Connect your Instagram account first (Instagram page).');
    return { client: this.graph(account.accessToken), account: account as InstagramAccount & { accessToken: string; igUserId: string } };
  }

  graph(token: string): GraphClient {
    return new GraphClient({ apiUrl: this.config.instagram.apiUrl, version: this.config.instagram.graphVersion, token });
  }

  async connect(accessToken: string): Promise<InstagramStatusDto> {
    let token = accessToken;
    let client = this.graph(token);
    let me: Awaited<ReturnType<GraphClient['me']>>;
    try {
      me = await client.me();
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
    // A refresh tells us when the token expires; brand-new tokens (under a day old) can't be refreshed yet.
    let expiresAt = new Date(Date.now() + 60 * DAY_MS);
    try {
      const refreshed = await client.refreshToken();
      token = refreshed.access_token;
      expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      client = this.graph(token);
    } catch {
      /* keep the pasted token */
    }
    let lastError: string | null = null;
    try {
      await client.subscribe(['comments']);
    } catch (error) {
      lastError = `Webhook subscription failed (polling still works): ${error instanceof Error ? error.message : String(error)}`;
    }
    await this.prisma.instagramAccount.upsert({
      where: { id: ACCOUNT_ID },
      create: { id: ACCOUNT_ID, igUserId: me.user_id ?? me.id, username: me.username, accessToken: token, tokenExpiresAt: expiresAt, lastError },
      update: { igUserId: me.user_id ?? me.id, username: me.username, accessToken: token, tokenExpiresAt: expiresAt, lastError },
    });
    this.logger.log(`Connected @${me.username}`);
    return this.status();
  }

  async disconnect(): Promise<InstagramStatusDto> {
    await this.prisma.instagramAccount.update({
      where: { id: ACCOUNT_ID },
      data: { accessToken: null, tokenExpiresAt: null, igUserId: null, username: null, lastError: null },
    });
    return this.status();
  }

  async update(input: InstagramAccountUpdate): Promise<InstagramStatusDto> {
    await this.account();
    await this.prisma.instagramAccount.update({ where: { id: ACCOUNT_ID }, data: input });
    return this.status();
  }

  async refreshNow(): Promise<InstagramStatusDto> {
    const { client } = await this.client();
    try {
      const refreshed = await client.refreshToken();
      await this.prisma.instagramAccount.update({
        where: { id: ACCOUNT_ID },
        data: { accessToken: refreshed.access_token, tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000), lastError: null },
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
    return this.status();
  }

  async recordError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const hint = error instanceof GraphError && error.isAuth ? ' Reconnect the account on the Instagram page.' : '';
    await this.prisma.instagramAccount.update({ where: { id: ACCOUNT_ID }, data: { lastError: `${message}${hint}`.slice(0, 500) } }).catch(() => undefined);
  }

  private async refreshIfDue(): Promise<void> {
    const a = await this.account().catch(() => null);
    if (!a?.accessToken || !a.tokenExpiresAt) return;
    if (a.tokenExpiresAt.getTime() - Date.now() > REFRESH_WITHIN_DAYS * DAY_MS) return;
    try {
      await this.refreshNow();
      this.logger.log('Refreshed the Instagram token');
    } catch (error) {
      this.logger.warn(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.recordError(error);
    }
  }

  /** Your latest Reels with the DM each one sends. */
  async reels(): Promise<InstagramReelDto[]> {
    const { client } = await this.client();
    const media = (await client.recentMedia(50)).filter((m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO');
    const ids = media.map((m) => m.id);
    const [rules, posts, counts] = await Promise.all([
      this.prisma.instagramRule.findMany({ where: { mediaId: { in: ids } } }),
      this.prisma.instagramPost.findMany({ where: { mediaId: { in: ids } }, select: { mediaId: true, projectId: true } }),
      this.prisma.instagramReply.groupBy({ by: ['mediaId'], where: { mediaId: { in: ids }, status: 'sent' }, _count: { _all: true } }),
    ]);
    const rule = new Map(rules.map((r) => [r.mediaId, r]));
    const projectOf = new Map<string, string>();
    for (const r of rules) if (r.projectId) projectOf.set(r.mediaId, r.projectId);
    for (const p of posts) if (p.mediaId) projectOf.set(p.mediaId, p.projectId);
    const projects = await this.prisma.project.findMany({ where: { id: { in: [...new Set(projectOf.values())] } }, select: { id: true, title: true } });
    const title = new Map(projects.map((p) => [p.id, p.title]));
    const sent = new Map(counts.map((c) => [c.mediaId, c._count._all]));
    return media.map((m) => {
      const r = rule.get(m.id);
      const projectId = projectOf.get(m.id) ?? null;
      return {
        mediaId: m.id,
        caption: m.caption ?? null,
        permalink: m.permalink ?? null,
        thumbnailUrl: m.thumbnail_url ?? null,
        timestamp: m.timestamp,
        dmText: r?.dmText ?? null,
        enabled: r?.enabled ?? false,
        projectId,
        projectTitle: projectId ? (title.get(projectId) ?? null) : null,
        sent: sent.get(m.id) ?? 0,
      };
    });
  }

  /** Sets (or replaces) the DM for one Reel. The first time, comments already there are skipped unless asked otherwise. */
  async setReelDm(mediaId: string, body: unknown, projectId: string | null = null): Promise<void> {
    const input = parseOrThrow(InstagramReelDmSchema, body);
    const isNew = !(await this.prisma.instagramRule.findUnique({ where: { mediaId } }));
    if (isNew && !input.includeExisting) await this.skipExistingComments(mediaId);
    await this.prisma.instagramRule.upsert({
      where: { mediaId },
      create: { mediaId, dmText: input.dmText, enabled: input.enabled, projectId },
      update: { dmText: input.dmText, enabled: input.enabled, ...(projectId ? { projectId } : {}) },
    });
  }

  async clearReelDm(mediaId: string): Promise<void> {
    await this.prisma.instagramRule.deleteMany({ where: { mediaId } });
  }

  /**
   * Marks every comment currently on a Reel as handled, so only comments made from now on get
   * the DM. For people who were already answered by hand. Returns how many were marked.
   */
  async skipExistingComments(mediaId: string): Promise<number> {
    const { client, account } = await this.client();
    const comments = (await client.comments(mediaId)).filter((c) => c.from?.id && c.from.id !== account.igUserId);
    const known = new Set(
      (await this.prisma.instagramReply.findMany({ where: { sourceId: { in: comments.map((c) => c.id) } }, select: { sourceId: true } })).map(
        (r) => r.sourceId,
      ),
    );
    const fresh = comments.filter((c) => !known.has(c.id));
    if (fresh.length) {
      await this.prisma.instagramReply.createMany({
        data: fresh.map((c) => ({
          kind: 'comment',
          sourceId: c.id,
          mediaId,
          fromId: c.from!.id,
          fromUsername: c.from!.username ?? null,
          text: c.text.slice(0, 1000),
          status: SKIPPED_EXISTING,
          detail: 'Commented before the DM was set',
        })),
      });
    }
    return fresh.length;
  }

  async activity(limit = 100): Promise<InstagramReplyDto[]> {
    const rows = await this.prisma.instagramReply.findMany({
      where: { status: { not: SKIPPED_EXISTING } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
    const posts = await this.prisma.instagramPost.findMany({ where: { mediaId: { in: rows.map((r) => r.mediaId).filter((x): x is string => Boolean(x)) } } });
    const permalink = new Map(posts.map((p) => [p.mediaId, p.permalink]));
    return rows.map((r) => ({
      id: r.id,
      mediaId: r.mediaId,
      permalink: r.mediaId ? (permalink.get(r.mediaId) ?? null) : null,
      fromUsername: r.fromUsername,
      text: r.text,
      status: r.status as InstagramReplyDto['status'],
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
