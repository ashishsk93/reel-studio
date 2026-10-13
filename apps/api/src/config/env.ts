import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { LLM_MODES, type LlmMode } from '@reel/shared';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  repoRoot: string;
  dataDir: string;
  databaseUrl: string;
  anthropicApiKey: string;
  modelDefault: string;
  modelReview: string;
  llmMode: LlmMode;
  jevApiKey: string;
  jevModel: string;
  jevApiUrl: string;
  fixturesDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  portApi: number;
  portWeb: number;
  /** Absolute origin used to build file URLs, e.g. http://localhost:4000 */
  apiOrigin: string;
  webOrigin: string;
}

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().default(''),
  ANTHROPIC_MODEL_DEFAULT: z.string().trim().min(1).default('claude-haiku-5-5'),
  ANTHROPIC_MODEL_REVIEW: z.string().trim().min(1).default('claude-haiku-5-5'),
  LLM_MODE: z.enum(LLM_MODES).default('live'),
  /** Optional: TypeSafe's Jev decision model (copy guardrail, best-version pick). Off when blank. */
  TYPESAFE_API_KEY: z.string().trim().default(''),
  JEV_MODEL: z.string().trim().min(1).default('jev-latest'),
  JEV_API_URL: z.string().trim().url().default('https://api.typesafe.ai'),
  LLM_FIXTURES_DIR: z.string().trim().optional(),
  DATA_DIR: z.string().trim().default('./data'),
  DATABASE_URL: z.string().trim().optional(),
  FFMPEG_PATH: z.string().trim().default('ffmpeg'),
  FFPROBE_PATH: z.string().trim().default('ffprobe'),
  PORT_API: z.coerce.number().int().positive().default(4000),
  PORT_WEB: z.coerce.number().int().positive().default(3000),
});

/** Walks up from `start` to the folder holding pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Empty strings in .env mean "unset" so defaults apply. */
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
  );
}

export function loadConfig(options: { repoRoot?: string; env?: NodeJS.ProcessEnv } = {}): AppConfig {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  if (!options.env) loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });

  const parsed = EnvSchema.safeParse(withoutBlanks(options.env ?? process.env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid .env configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const dataDir = path.resolve(repoRoot, env.DATA_DIR);

  return {
    repoRoot,
    dataDir,
    databaseUrl: env.DATABASE_URL ?? `file:${path.join(dataDir, 'app.db')}`,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    modelDefault: env.ANTHROPIC_MODEL_DEFAULT,
    modelReview: env.ANTHROPIC_MODEL_REVIEW,
    llmMode: env.LLM_MODE,
    jevApiKey: env.TYPESAFE_API_KEY,
    jevModel: env.JEV_MODEL,
    jevApiUrl: env.JEV_API_URL.replace(/\/$/, ''),
    fixturesDir: path.resolve(repoRoot, env.LLM_FIXTURES_DIR ?? 'apps/api/test/fixtures/llm'),
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    portApi: env.PORT_API,
    portWeb: env.PORT_WEB,
    apiOrigin: `http://localhost:${env.PORT_API}`,
    webOrigin: `http://localhost:${env.PORT_WEB}`,
  };
}
