import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type {
  InstagramAccountUpdate,
  InstagramMediaDto,
  InstagramReplyDto,
  InstagramRuleDto,
  InstagramStatusDto,
} from '@reel/shared';
import { InstagramRuleSchema } from '@reel/shared';
import type { InstagramAccount, InstagramRule } from '../generated/prisma/client';
import { parseOrThrow } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { GraphClient, GraphError } from './graph';

const ACCOUNT_ID = 'me';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Refresh when fewer than this many days are left (tokens last 60). */
const REFRESH_WITHIN_DAYS = 20;
const REFRESH_CHECK_MS = 6 * 60 * 60 * 1000;

/** The connected account, its token, and the keyword rules. */
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
      await client.subscribe(['comments', 'messages']);
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

  async recentMedia(): Promise<InstagramMediaDto[]> {
    const { client } = await this.client();
    const media = await client.recentMedia(24);
    return media.map((m) => ({
      id: m.id,
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? (m.media_url ?? null) : null),
      timestamp: m.timestamp,
    }));
  }

  // ---------- Rules ----------

  async rules(): Promise<InstagramRuleDto[]> {
    const rules = await this.prisma.instagramRule.findMany({ orderBy: { createdAt: 'desc' } });
    return this.ruleDtos(rules);
  }

  async createRule(body: unknown, extra: { projectId?: string | null } = {}): Promise<InstagramRuleDto> {
    const input = parseOrThrow(InstagramRuleSchema, body);
    const rule = await this.prisma.instagramRule.create({
      data: { ...input, matchDms: input.mediaId ? false : input.matchDms, projectId: extra.projectId ?? null },
    });
    return (await this.ruleDtos([rule]))[0]!;
  }

  async updateRule(id: string, body: unknown): Promise<InstagramRuleDto> {
    const existing = await this.prisma.instagramRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rule not found');
    const input = parseOrThrow(InstagramRuleSchema, { ...existing, ...(body as object) });
    const rule = await this.prisma.instagramRule.update({
      where: { id },
      data: {
        keyword: input.keyword,
        dmText: input.dmText,
        commentReply: input.commentReply,
        mediaId: input.mediaId,
        matchDms: input.mediaId ? false : input.matchDms,
        enabled: input.enabled,
      },
    });
    return (await this.ruleDtos([rule]))[0]!;
  }

  async deleteRule(id: string): Promise<void> {
    await this.prisma.instagramRule.deleteMany({ where: { id } });
  }

  private async ruleDtos(rules: InstagramRule[]): Promise<InstagramRuleDto[]> {
    const mediaIds = rules.map((r) => r.mediaId).filter((m): m is string => Boolean(m));
    const projectIds = rules.map((r) => r.projectId).filter((p): p is string => Boolean(p));
    const [posts, projects] = await Promise.all([
      this.prisma.instagramPost.findMany({ where: { mediaId: { in: mediaIds } } }),
      this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, title: true } }),
    ]);
    const permalink = new Map(posts.map((p) => [p.mediaId, p.permalink]));
    const title = new Map(projects.map((p) => [p.id, p.title]));
    return rules.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      dmText: r.dmText,
      commentReply: r.commentReply,
      mediaId: r.mediaId,
      matchDms: r.matchDms,
      enabled: r.enabled,
      projectId: r.projectId,
      projectTitle: r.projectId ? (title.get(r.projectId) ?? null) : null,
      permalink: r.mediaId ? (permalink.get(r.mediaId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async activity(limit = 100): Promise<InstagramReplyDto[]> {
    const rows = await this.prisma.instagramReply.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) });
    const rules = await this.prisma.instagramRule.findMany({ where: { id: { in: rows.map((r) => r.ruleId).filter((x): x is string => Boolean(x)) } } });
    const keyword = new Map(rules.map((r) => [r.id, r.keyword]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as InstagramReplyDto['kind'],
      mediaId: r.mediaId,
      fromUsername: r.fromUsername,
      text: r.text,
      keyword: r.ruleId ? (keyword.get(r.ruleId) ?? null) : null,
      status: r.status as InstagramReplyDto['status'],
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
