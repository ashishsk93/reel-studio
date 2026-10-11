import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

const repoRoot = path.resolve(__dirname, '../..');
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

const dataDir = path.resolve(repoRoot, process.env.DATA_DIR ?? './data');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? `file:${path.join(dataDir, 'app.db').split(path.sep).join('/')}`,
  },
});
