import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVATE_REPLY_WINDOW_MS, shouldReply } from './auto-reply';
import { InstagramService } from './instagram.service';
import { matchesKeyword, parseWebhook, type IgComment } from './webhook';

const POLL_MS = 90_000;

/**
 * Answers keyword comments on a Reel with that Reel's DM (and optionally a shared public reply).
 * Webhooks deliver comments when the Meta app is Live; the poller reads them either way. Each
 * comment is recorded once, so the two never double up.
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
    for (const comment of parseWebhook(body, own)) await this.handle(comment);
  }

  /** What happened, or null when nothing applies (or the comment was already handled). */
  async handle(comment: IgComment): Promise<'sent' | 'failed' | 'skipped' | null> {
    const account = await this.instagram.account();
    if (!account.accessToken || !account.autoReply || !comment.mediaId) return null;
    const rule = await this.prisma.instagramRule.findUnique({ where: { mediaId: comment.mediaId } });
    if (!rule || !shouldReply(comment, rule, account.keyword)) return null;

    // One DM per person per Reel: people often comment the keyword twice. Someone who asked
    // before the DM was set was likely answered by hand, so they count as done too.
    const earlier = await this.prisma.instagramReply.findMany({
      where: { fromId: comment.fromId, mediaId: comment.mediaId, status: { in: ['sent', 'existing'] } },
    });
    const already = earlier.some((r) => r.status === 'sent' || matchesKeyword(r.text, account.keyword));
    const base = {
      kind: 'comment',
      sourceId: comment.id,
      mediaId: comment.mediaId,
      fromId: comment.fromId,
      fromUsername: comment.fromUsername,
      text: comment.text.slice(0, 1000),
      ruleId: rule.id,
    };

    // The unique sourceId doubles as a lock between the webhook and the poller.
    try {
      await this.prisma.instagramReply.create({
        data: { ...base, status: already ? 'skipped' : 'pending', detail: already ? 'Already answered this person' : null },
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
      await client.privateReply(comment.id, rule.dmText);
      sent = true;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      await this.instagram.recordError(error);
    }
    // "Sent you a DM" only makes sense when the DM went out.
    if (sent && account.commentReply) {
      try {
        await client.replyToComment(comment.id, account.commentReply);
      } catch (error) {
        problems.push(`Public reply: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.prisma.instagramReply.update({
      where: { sourceId: comment.id },
      data: { status: sent ? 'sent' : 'failed', detail: problems.length ? problems.join(' · ').slice(0, 500) : null },
    });
    this.logger.log(`${sent ? 'Sent' : 'Failed'} DM to ${comment.fromUsername ?? comment.fromId}`);
    return sent ? 'sent' : 'failed';
  }

  /** Reads recent comments on Reels that have a DM and answers the ones not seen yet. */
  async poll(force = false): Promise<{ checked: number; answered: number }> {
    if (this.polling) return { checked: 0, answered: 0 };
    this.polling = true;
    try {
      const account = await this.instagram.account();
      if (!account.accessToken || !account.autoReply || (!account.poll && !force)) return { checked: 0, answered: 0 };
      const rules = await this.prisma.instagramRule.findMany({ where: { enabled: true } });
      if (!rules.length) return { checked: 0, answered: 0 };

      const { client } = await this.instagram.client();
      let checked = 0;
      let answered = 0;
      for (const { mediaId } of rules) {
        const comments = await client.comments(mediaId);
        const fresh = comments.filter(
          (c) =>
            c.from?.id &&
            c.from.id !== account.igUserId &&
            c.from.username !== account.username &&
            Date.now() - new Date(c.timestamp).getTime() < PRIVATE_REPLY_WINDOW_MS,
        );
        const seen = new Set(
          (await this.prisma.instagramReply.findMany({ where: { sourceId: { in: fresh.map((c) => c.id) } }, select: { sourceId: true } })).map((r) => r.sourceId),
        );
        for (const c of fresh) {
          checked++;
          if (seen.has(c.id)) continue;
          const result = await this.handle({ id: c.id, text: c.text, mediaId, fromId: c.from!.id, fromUsername: c.from!.username ?? null, createdAt: new Date(c.timestamp) });
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
