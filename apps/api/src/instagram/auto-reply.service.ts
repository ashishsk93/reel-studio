import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVATE_REPLY_WINDOW_MS, pickRule } from './auto-reply';
import { InstagramService } from './instagram.service';
import { parseWebhook, type IgEvent } from './webhook';

const POLL_MS = 90_000;
/** Every-post rules check this many of the latest posts. */
const POLL_RECENT_MEDIA = 10;

/**
 * Answers "Comment LINK" comments with a private DM (and optionally a public reply), and
 * keyword DMs with a DM. Webhooks deliver events when the Meta app is Live; the poller reads
 * recent comments either way. Each comment or message is recorded once, so the two never double up.
 */
@Injectable()
export class AutoReplyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AutoReply');
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly instagram: InstagramService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll().catch(() => undefined), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Webhook POST body (signature already checked). */
  async handleWebhook(body: unknown): Promise<void> {
    const account = await this.instagram.account();
    await this.prisma.instagramAccount.update({ where: { id: account.id }, data: { lastWebhookAt: new Date() } });
    const own = new Set([account.igUserId].filter((x): x is string => Boolean(x)));
    for (const event of parseWebhook(body, own)) await this.handle(event);
  }

  /** What happened, or null when no rule applies (or the event was already handled). */
  async handle(event: IgEvent): Promise<'sent' | 'failed' | 'skipped' | null> {
    const account = await this.instagram.account();
    if (!account.accessToken || !account.autoReply) return null;
    const rules = await this.prisma.instagramRule.findMany({ where: { enabled: true } });
    const rule = pickRule(event, rules);
    if (!rule) return null;

    const mediaId = event.kind === 'comment' ? event.mediaId : null;
    const base = { kind: event.kind, sourceId: event.id, mediaId, fromId: event.fromId, fromUsername: event.fromUsername, text: event.text.slice(0, 1000), ruleId: rule.id };

    // One DM per person per rule (per post for comments): people often comment the keyword twice.
    const already = await this.prisma.instagramReply.findFirst({
      where: { fromId: event.fromId, ruleId: rule.id, status: 'sent', ...(event.kind === 'comment' ? { mediaId } : { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }) },
    });

    // The unique sourceId doubles as a lock between the webhook and the poller.
    try {
      await this.prisma.instagramReply.create({
        data: { ...base, status: already ? 'skipped' : 'pending', detail: already ? 'Already sent this person the DM' : null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
    if (already) return 'skipped';

    const { client } = await this.instagram.client();
    const problems: string[] = [];
    let sent = false;
    try {
      if (event.kind === 'comment') await client.privateReply(event.id, rule.dmText);
      else await client.sendMessage(event.fromId, rule.dmText);
      sent = true;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      await this.instagram.recordError(error);
    }
    // "Sent you a DM" only makes sense when the DM went out.
    if (sent && event.kind === 'comment' && rule.commentReply) {
      try {
        await client.replyToComment(event.id, rule.commentReply);
      } catch (error) {
        problems.push(`Public reply: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.prisma.instagramReply.update({
      where: { sourceId: event.id },
      data: { status: sent ? 'sent' : 'failed', detail: problems.length ? problems.join(' · ').slice(0, 500) : null },
    });
    this.logger.log(`${sent ? 'Sent' : 'Failed'} "${rule.keyword}" ${event.kind} reply to ${event.fromUsername ?? event.fromId}`);
    return sent ? 'sent' : 'failed';
  }

  /** Reads recent comments on posts that have a rule and answers the ones not seen yet. */
  async poll(force = false): Promise<{ checked: number; answered: number }> {
    if (this.polling) return { checked: 0, answered: 0 };
    this.polling = true;
    try {
      const account = await this.instagram.account();
      if (!account.accessToken || !account.autoReply || (!account.poll && !force)) return { checked: 0, answered: 0 };
      const rules = await this.prisma.instagramRule.findMany({ where: { enabled: true } });
      if (!rules.length) return { checked: 0, answered: 0 };

      const { client } = await this.instagram.client();
      const mediaIds = new Set(rules.map((r) => r.mediaId).filter((m): m is string => Boolean(m)));
      if (rules.some((r) => r.mediaId === null)) {
        const recent = await client.recentMedia(POLL_RECENT_MEDIA);
        for (const m of recent) mediaIds.add(m.id);
      }

      let checked = 0;
      let answered = 0;
      for (const mediaId of mediaIds) {
        const comments = await client.comments(mediaId);
        const fresh = comments.filter((c) => c.from?.id && c.from.id !== account.igUserId && c.from.username !== account.username && Date.now() - new Date(c.timestamp).getTime() < PRIVATE_REPLY_WINDOW_MS);
        const seen = new Set(
          (await this.prisma.instagramReply.findMany({ where: { sourceId: { in: fresh.map((c) => c.id) } }, select: { sourceId: true } })).map((r) => r.sourceId),
        );
        for (const c of fresh) {
          checked++;
          if (seen.has(c.id)) continue;
          const result = await this.handle({ kind: 'comment', id: c.id, text: c.text, mediaId, fromId: c.from!.id, fromUsername: c.from!.username ?? null, createdAt: new Date(c.timestamp) });
          if (result === 'sent') answered++;
        }
      }
      await this.prisma.instagramAccount.update({ where: { id: account.id }, data: { lastPollAt: new Date() } });
      return { checked, answered };
    } catch (error) {
      this.logger.warn(`Poll failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.instagram.recordError(error);
      if (force) throw error;
      return { checked: 0, answered: 0 };
    } finally {
      this.polling = false;
    }
  }
}
