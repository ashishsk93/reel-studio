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
  openaiApiKey: string;
  decisionModel: string;
  openaiApiUrl: string;
  fixturesDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  portApi: number;
  portWeb: number;
  /** Absolute origin used to build file URLs, e.g. http://localhost:4000 */
  apiOrigin: string;
  webOrigin: string;
  /** Public HTTPS origin the API is reachable at (webhooks, media for publishing); '' when local only. */
  publicUrl: string;
  instagram: {
    appSecret: string;
    verifyToken: string;
    apiUrl: string;
    graphVersion: string;
  };
}

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().default(''),
  ANTHROPIC_MODEL_DEFAULT: z.string().trim().min(1).default('claude-haiku-5-5'),
  ANTHROPIC_MODEL_REVIEW: z.string().trim().min(1).default('claude-haiku-5-5'),
  LLM_MODE: z.enum(LLM_MODES).default('live'),
  /** Optional: OpenAI's Decisions API (copy guardrail, recommended version, badge check, cover frame). Off when blank. */
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_DECISION_MODEL: z.string().trim().min(1).default('gpt-6-luna'),
  OPENAI_API_URL: z.string().trim().url().default('https://api.openai.com'),
  LLM_FIXTURES_DIR: z.string().trim().optional(),
  DATA_DIR: z.string().trim().default('./data'),
  DATABASE_URL: z.string().trim().optional(),
  FFMPEG_PATH: z.string().trim().default('ffmpeg'),
  FFPROBE_PATH: z.string().trim().default('ffprobe'),
  PORT_API: z.coerce.number().int().positive().default(4000),
  PORT_WEB: z.coerce.number().int().positive().default(3000),
  /** e.g. https://studio.velra.tech. Needed to publish to Instagram and receive its webhooks. */
  PUBLIC_URL: z.string().trim().url().optional(),
  /** Optional: Instagram API with Instagram Login (your own account). App secret signs webhooks and media links. */
  INSTAGRAM_APP_SECRET: z.string().trim().default(''),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().trim().default(''),
  INSTAGRAM_API_URL: z.string().trim().url().default('https://graph.instagram.com'),
  INSTAGRAM_GRAPH_VERSION: z.string().trim().regex(/^v\d+\.\d+$/).default('v26.0'),
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
    openaiApiKey: env.OPENAI_API_KEY,
    decisionModel: env.OPENAI_DECISION_MODEL,
    openaiApiUrl: env.OPENAI_API_URL.replace(/\/$/, ''),
    fixturesDir: path.resolve(repoRoot, env.LLM_FIXTURES_DIR ?? 'apps/api/test/fixtures/llm'),
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    portApi: env.PORT_API,
    portWeb: env.PORT_WEB,
    apiOrigin: `http://localhost:${env.PORT_API}`,
    webOrigin: `http://localhost:${env.PORT_WEB}`,
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    instagram: {
      appSecret: env.INSTAGRAM_APP_SECRET,
      verifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
      apiUrl: env.INSTAGRAM_API_URL.replace(/\/$/, ''),
      graphVersion: env.INSTAGRAM_GRAPH_VERSION,
    },
  };
}
