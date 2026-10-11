import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { InfluencerCreateSchema } from '@reel/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadConfig } from '../src/config/env';
import { SEED_INFLUENCERS } from './seed-data/influencers';
import { SEED_SOURCES } from './seed-data/sources';

/** Idempotent: creates missing rows and never overwrites edits made in the UI. */
async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: config.databaseUrl }) });

  try {
    for (const source of SEED_SOURCES) {
      const existing = await prisma.source.findUnique({ where: { key: source.key } });
      if (existing) continue;
      await prisma.source.create({ data: source });
      console.log(`+ source ${source.displayName}`);
    }

    for (const seed of SEED_INFLUENCERS) {
      const data = InfluencerCreateSchema.parse(seed);
      const existing = await prisma.influencer.findUnique({ where: { slug: seed.slug } });
      if (existing) continue;
      await prisma.influencer.create({ data: { ...data, slug: seed.slug } });
      console.log(`+ influencer ${seed.name}`);
    }
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
