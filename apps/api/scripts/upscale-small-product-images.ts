/**
 * One-off fix for product photos uploaded before small images were upscaled on upload: any
 * product image with a side under 512 px is upscaled in place (short side 768). The original is
 * kept next to it under product/originals/. Safe to run more than once.
 *   pnpm --filter @reel/api exec tsx scripts/upscale-small-product-images.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config/env';
import { MIN_ATTACHMENT_SIDE, inspectImage, upscaleIfSmall } from '../src/storage/uploads';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(path.join(config.dataDir, 'app.db'));
  const rows = db
    .prepare('SELECT id, path, width, height FROM ProductImage WHERE width < ? OR height < ?')
    .all(MIN_ATTACHMENT_SIDE, MIN_ATTACHMENT_SIDE) as Array<{ id: string; path: string; width: number; height: number }>;
  const update = db.prepare('UPDATE ProductImage SET width = ?, height = ? WHERE id = ?');
  for (const row of rows) {
    const abs = path.join(config.dataDir, row.path);
    const backup = path.join(path.dirname(abs), 'originals', path.basename(abs));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(abs, backup);
    const out = await upscaleIfSmall(abs, await inspectImage(abs, path.basename(abs)));
    update.run(out.width, out.height, row.id);
    console.log(`${row.path}: ${row.width}×${row.height} → ${out.width}×${out.height} (original kept in originals/)`);
  }
  console.log(`${rows.length} image(s) upscaled.`);
  db.close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
