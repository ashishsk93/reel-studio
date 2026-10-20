import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findRepoRoot, loadConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AutoReplyService } from './auto-reply.service';
import type { GraphClient } from './graph';
import { InstagramService } from './instagram.service';
import type { IgComment } from './webhook';

/** Runs the auto-replier against a throwaway SQLite database and a fake Graph client. */
describe('AutoReplyService', () => {
  let dir: string;
  let prisma: PrismaService;
  let service: AutoReplyService;
  const sent: Array<{ to: string; text: string; via: string }> = [];
  let failNext = false;

  const graph = {
    privateReply: async (commentId: string, text: string) => {
      if (failNext) {
        failNext = false;
        throw new Error('Instagram: nope');
      }
      sent.push({ to: commentId, text, via: 'private' });
      return {};
    },
    replyToComment: async (id: string, text: string) => (sent.push({ to: id, text, via: 'public' }), { id: 'r' }),
  } as unknown as GraphClient;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-ig-'));
    const repoRoot = findRepoRoot(__dirname);
    const config = loadConfig({ repoRoot, env: { DATA_DIR: dir } });
    prisma = new PrismaService(config);
    const migrations = path.join(repoRoot, 'apps/api/prisma/migrations');
    for (const name of fs.readdirSync(migrations).filter((n) => /^\d/.test(n)).sort()) {
      const sql = fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s))) {
        await prisma.$executeRawUnsafe(statement);
      }
    }
    const instagram = new InstagramService(config, prisma);
    instagram.client = async () => ({ client: graph, account: (await instagram.account()) as never });
    service = new AutoReplyService(prisma, instagram);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sent.length = 0;
    await prisma.instagramReply.deleteMany();
    await prisma.instagramRule.deleteMany();
    await prisma.instagramAccount.upsert({
      where: { id: 'me' },
      create: { id: 'me', igUserId: 'own', username: 'slay', accessToken: 'T', autoReply: true, keyword: 'LINK', commentReply: 'Check your DMs' },
      update: { accessToken: 'T', autoReply: true, keyword: 'LINK', commentReply: 'Check your DMs' },
    });
    await prisma.instagramRule.create({ data: { dmText: 'Here it is', mediaId: 'm1' } });
  });

  const comment = (id: string, from = 'u1', text = 'link pls', mediaId = 'm1'): IgComment => ({
    id,
    text,
    mediaId,
    fromId: from,
    fromUsername: from,
    createdAt: new Date(),
  });

  it('DMs the commenter and replies publicly, once per comment', async () => {
    expect(await service.handle(comment('c1'))).toBe('sent');
    expect(sent).toEqual([
      { to: 'c1', text: 'Here it is', via: 'private' },
      { to: 'c1', text: 'Check your DMs', via: 'public' },
    ]);
    expect(await service.handle(comment('c1'))).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('skips a second comment from the same person on the same post', async () => {
    await service.handle(comment('c1'));
    expect(await service.handle(comment('c2'))).toBe('skipped');
    expect(await service.handle(comment('c3', 'u2'))).toBe('sent');
    expect(sent.filter((s) => s.via === 'private').map((s) => s.to)).toEqual(['c1', 'c3']);
  });

  it('ignores comments without the keyword, and everything when switched off', async () => {
    expect(await service.handle(comment('c1', 'u1', 'so pretty'))).toBeNull();
    await prisma.instagramAccount.update({ where: { id: 'me' }, data: { autoReply: false } });
    expect(await service.handle(comment('c2'))).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('records a failed send so it is visible and not retried', async () => {
    failNext = true;
    expect(await service.handle(comment('c1'))).toBe('failed');
    const row = await prisma.instagramReply.findUniqueOrThrow({ where: { sourceId: 'c1' } });
    expect(row.status).toBe('failed');
    expect(row.detail).toContain('nope');
    expect(await service.handle(comment('c1'))).toBeNull();
  });

  it('only answers Reels that have a DM, each with its own text', async () => {
    expect(await service.handle(comment('c1', 'u1', 'link', 'm2'))).toBeNull();
    await prisma.instagramRule.create({ data: { dmText: 'Other Reel link', mediaId: 'm2' } });
    expect(await service.handle(comment('c2', 'u1', 'link', 'm2'))).toBe('sent');
    expect(sent[0]).toEqual({ to: 'c2', text: 'Other Reel link', via: 'private' });
  });

  it('uses the shared keyword', async () => {
    await prisma.instagramAccount.update({ where: { id: 'me' }, data: { keyword: 'SHOP' } });
    expect(await service.handle(comment('c1', 'u1', 'link'))).toBeNull();
    expect(await service.handle(comment('c2', 'u1', 'shop pls'))).toBe('sent');
  });
});
