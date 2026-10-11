import type { AppConfig } from './env';
import { binaryVersion } from '../media/process';

export interface ToolVersions {
  ffmpeg: string;
  ffprobe: string;
}

export class StartupError extends Error {
  constructor(readonly problems: string[]) {
    super(`Reel Studio can't start:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}`);
  }
}

/** Fails fast with every problem listed at once, so one restart fixes them all. */
export async function runStartupChecks(config: AppConfig): Promise<ToolVersions> {
  const problems: string[] = [];

  if ((config.llmMode === 'live' || config.llmMode === 'record') && !config.anthropicApiKey) {
    problems.push(
      'ANTHROPIC_API_KEY is empty. Paste your key into .env, or set LLM_MODE=mock to run with canned responses.',
    );
  }

  const [ffmpeg, ffprobe] = await Promise.all([
    binaryVersion(config.ffmpegPath),
    binaryVersion(config.ffprobePath),
  ]);
  if (!ffmpeg) problems.push(`FFmpeg not found at "${config.ffmpegPath}". Install it (see README) or set FFMPEG_PATH in .env.`);
  if (!ffprobe) problems.push(`ffprobe not found at "${config.ffprobePath}". Install it (see README) or set FFPROBE_PATH in .env.`);

  if (problems.length > 0) throw new StartupError(problems);
  return { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
}
