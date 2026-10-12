import type { VideoProbeDto } from '@reel/shared';
import { FPS } from './cuts';

/** Typed FFmpeg/ffprobe argument builders. Always argument arrays, never shell strings. */

export function probeArgs(input: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
}

/**
 * Normalised copy used for playback, frames, cut detection and the render: constant 30 fps
 * (fixes variable frame rate and 24 fps inputs), rotation applied (FFmpeg autorotates),
 * even dimensions, square pixels, yuv420p H.264, no audio (Kling runs with sound off).
 */
export function normalizeArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-vf',
    `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-an',
    '-movflags',
    '+faststart',
    output,
  ];
}

/** Prints every frame whose scene-change score exceeds `floor`, with its score. */
export function sceneCutArgs(input: string, floor: number): string[] {
  return ['-hide_banner', '-i', input, '-vf', `select='gt(scene,${floor})',metadata=print`, '-an', '-f', 'null', '-'];
}

/** Several exact frames in one decoding pass; outputs are numbered in frame order. */
export function framesArgs(input: string, frameNumbers: number[], outPattern: string, height = 640): string[] {
  const select = frameNumbers.map((n) => `eq(n,${n})`).join('+');
  return [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-vf',
    `select='${select}',scale=-2:${height}`,
    '-fps_mode',
    'passthrough',
    '-q:v',
    '4',
    outPattern,
  ];
}

/** One exact frame (input seeking is frame-accurate on the CFR copy). */
export function frameAtArgs(input: string, t: number, output: string, height = 960): string[] {
  return ['-hide_banner', '-y', '-ss', t.toFixed(3), '-i', input, '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '3', output];
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    duration?: string;
    tags?: Record<string, string>;
    side_data_list?: Array<{ rotation?: number }>;
  }>;
  format?: { duration?: string; format_name?: string };
}

function rate(value: string | undefined): number {
  if (!value) return 0;
  const [n, d] = value.split('/').map(Number);
  return d ? n / d : n || 0;
}

export class ProbeError extends Error {}

export function parseProbe(json: string): VideoProbeDto {
  let data: ProbeJson;
  try {
    data = JSON.parse(json) as ProbeJson;
  } catch {
    throw new ProbeError('ffprobe returned unreadable output.');
  }
  const video = data.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new ProbeError('No video stream found. Upload an MP4, MOV or WebM video.');
  const rotationRaw = video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  const rotation = ((Math.round(rotationRaw) % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const avg = rate(video.avg_frame_rate);
  const real = rate(video.r_frame_rate);
  const durationSec = Number(data.format?.duration ?? video.duration ?? 0);
  return {
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    fps: Math.round((avg || real) * 100) / 100,
    durationSec: Math.round(durationSec * 1000) / 1000,
    codec: video.codec_name ?? 'unknown',
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
    vfr: avg > 0 && real > 0 && Math.abs(avg - real) / real > 0.01,
    rotation,
  };
}
