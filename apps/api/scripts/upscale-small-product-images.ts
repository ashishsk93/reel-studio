/**
 * One-off fix for product photos uploaded before small images were upscaled on upload: any
 * product image with a side under 512 px is upscaled in place (short side 768). The original is
 * kept next to it under product/originals/. Safe to run more than once.
 *   pnpm --filter @reel/api exec tsx scripts/upscale-small-product-images.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadConfig } from '../src/config/env';
import { MIN_ATTACHMENT_SIDE, inspectImage, upscaleIfSmall } from '../src/storage/uploads';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: config.databaseUrl }) });
  try {
    const rows = await prisma.productImage.findMany({
      where: { OR: [{ width: { lt: MIN_ATTACHMENT_SIDE } }, { height: { lt: MIN_ATTACHMENT_SIDE } }] },
      select: { id: true, path: true, width: true, height: true },
    });
    for (const row of rows) {
      const abs = path.join(config.dataDir, row.path);
      const backup = path.join(path.dirname(abs), 'originals', path.basename(abs));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(abs, backup);
      const out = await upscaleIfSmall(abs, await inspectImage(abs, path.basename(abs)));
      await prisma.productImage.update({ where: { id: row.id }, data: { width: out.width, height: out.height } });
      console.log(`${row.path}: ${row.width}×${row.height} → ${out.width}×${out.height} (original kept in originals/)`);
    }
    console.log(`${rows.length} image(s) upscaled.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
