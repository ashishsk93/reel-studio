import type { QaCheckDto } from '@reel/shared';
import { OUT } from './render-args';

export interface FinalProbe {
  width: number;
  height: number;
  fps: number;
  avgFps: number;
  codec: string;
  profile: string;
  pixFmt: string;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  durationSec: number;
}

const rate = (v?: string) => {
  if (!v) return 0;
  const [n, d] = v.split('/').map(Number);
  return d ? n / d : n || 0;
};

export function parseFinalProbe(json: string): FinalProbe {
  const data = JSON.parse(json) as {
    streams?: Array<Record<string, string | number | undefined>>;
    format?: { duration?: string };
  };
  const v = data.streams?.find((s) => s.codec_type === 'video') ?? {};
  const a = data.streams?.find((s) => s.codec_type === 'audio');
  return {
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    fps: Math.round(rate(String(v.r_frame_rate ?? '')) * 100) / 100,
    avgFps: Math.round(rate(String(v.avg_frame_rate ?? '')) * 100) / 100,
    codec: String(v.codec_name ?? ''),
    profile: String(v.profile ?? ''),
    pixFmt: String(v.pix_fmt ?? ''),
    audioCodec: a ? String(a.codec_name ?? '') : null,
    sampleRate: a ? Number(a.sample_rate ?? 0) : null,
    channels: a ? Number(a.channels ?? 0) : null,
    durationSec: Math.round(Number(data.format?.duration ?? 0) * 1000) / 1000,
  };
}

export function qaChecks(p: FinalProbe, expectedSec: number, target = { min: 16, max: 20 }): QaCheckDto[] {
  return [
    { label: 'Resolution 1080×1920', ok: p.width === OUT.w && p.height === OUT.h, detail: `${p.width}×${p.height}` },
    { label: 'Constant 30 fps', ok: Math.abs(p.fps - 30) < 0.01 && Math.abs(p.avgFps - 30) < 0.05, detail: `${p.fps} fps (average ${p.avgFps})` },
    { label: 'H.264 High, yuv420p', ok: p.codec === 'h264' && /high/i.test(p.profile) && p.pixFmt === 'yuv420p', detail: `${p.codec} ${p.profile}, ${p.pixFmt}` },
    {
      label: 'AAC 48 kHz stereo',
      ok: p.audioCodec === 'aac' && p.sampleRate === 48000 && p.channels === 2,
      detail: p.audioCodec ? `${p.audioCodec} ${p.sampleRate} Hz, ${p.channels} ch` : 'no audio track',
    },
    { label: 'Duration as planned', ok: Math.abs(p.durationSec - expectedSec) <= 0.12, detail: `${p.durationSec} s (planned ${Math.round(expectedSec * 100) / 100} s)` },
    {
      label: `Reel length ${target.min}–${target.max} s`,
      ok: p.durationSec >= target.min - 0.05 && p.durationSec <= target.max + 0.05,
      detail: `${p.durationSec} s`,
    },
  ];
}

export interface BlackInterval {
  start: number;
  end: number;
  nearJoin: boolean;
}

/** `blackdetect` lines → intervals, flagged when they sit within 0.25 s of a join. */
export function parseBlackdetect(stderr: string, joins: number[]): BlackInterval[] {
  const out: BlackInterval[] = [];
  const re = /black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)/g;
  for (const m of stderr.matchAll(re)) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    out.push({ start, end, nearJoin: joins.some((j) => j >= start - 0.25 && j <= end + 0.25) });
  }
  return out;
}

export function blackdetectArgs(input: string): string[] {
  return ['-hide_banner', '-i', input, '-vf', 'blackdetect=d=0.05:pix_th=0.10', '-an', '-f', 'null', '-'];
}

/** "time=00:00:05.12" in FFmpeg's progress output → seconds. */
export function progressSeconds(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
