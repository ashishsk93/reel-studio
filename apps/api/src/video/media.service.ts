import fs from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { VideoProbeDto } from '@reel/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { runProcess } from '../media/process';
import { LogService } from '../storage/log.service';
import { parseSceneScores, type SceneChange } from './cuts';
import { frameAtArgs, framesArgs, normalizeArgs, parseProbe, probeArgs, sceneCutArgs } from './ffmpeg';

export class MediaError extends Error {}

/** Runs FFmpeg/ffprobe with the typed builders; every command goes to the project's ffmpeg.log. */
@Injectable()
export class MediaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logs: LogService,
  ) {}

  async run(bin: 'ffmpeg' | 'ffprobe', args: string[], projectId: string | null, signal?: AbortSignal, onStderrLine?: (line: string) => void) {
    const command = bin === 'ffmpeg' ? this.config.ffmpegPath : this.config.ffprobePath;
    const result = await runProcess(command, args, { timeoutMs: 20 * 60_000, signal, onStderrLine });
    const tail = result.stderr.split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
    this.logs.write('ffmpeg', projectId, { bin, args, code: result.code, durationMs: result.durationMs, stderrTail: result.code === 0 ? undefined : tail });
    if (result.code !== 0) throw new MediaError(`${bin} failed (exit ${result.code}): ${tail.slice(-400)}`);
    return result;
  }

  async probe(abs: string, projectId: string | null): Promise<VideoProbeDto> {
    const result = await this.run('ffprobe', probeArgs(abs), projectId);
    return parseProbe(result.stdout);
  }

  async normalize(input: string, output: string, projectId: string | null, signal?: AbortSignal): Promise<void> {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const tmp = `${output}.part.mp4`;
    await this.run('ffmpeg', normalizeArgs(input, tmp), projectId, signal);
    await fs.rename(tmp, output);
  }

  /** Scene changes scoring above `floor` (well below the cut threshold, so weaker cuts can still be matched to the plan). */
  async sceneChanges(input: string, floor: number, projectId: string | null, signal?: AbortSignal): Promise<SceneChange[]> {
    const result = await this.run('ffmpeg', sceneCutArgs(input, floor), projectId, signal);
    return parseSceneScores(result.stderr);
  }

  /** Extracts the given frames into `dir`; returns the files in frame order. */
  async extractFrames(input: string, frameNumbers: number[], dir: string, projectId: string | null, signal?: AbortSignal): Promise<string[]> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const sorted = [...new Set(frameNumbers)].sort((a, b) => a - b);
    await this.run('ffmpeg', framesArgs(input, sorted, path.join(dir, 'f_%03d.jpg')), projectId, signal);
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('f_')).sort();
    if (files.length !== sorted.length) {
      throw new MediaError(`Expected ${sorted.length} frames, FFmpeg wrote ${files.length}.`);
    }
    return files.map((f) => path.join(dir, f));
  }

  async frameAt(input: string, t: number, output: string, projectId: string | null, height?: number): Promise<void> {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const tmp = `${output}.part.jpg`;
    await this.run('ffmpeg', frameAtArgs(input, t, tmp, height), projectId);
    await fs.rename(tmp, output);
  }
}
