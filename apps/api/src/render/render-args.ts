/** Instagram Reels output: 1080×1920, 30 fps CFR, H.264 High yuv420p, AAC 48 kHz stereo. */
export const OUT = { w: 1080, h: 1920, fps: 30 } as const;

export interface RenderSegmentPlan {
  input: string;
  inSec: number;
  durationSec: number;
  textPng: string | null;
  /** Badge image scaled to w×h and placed at x,y (output pixels). */
  badge: { png: string; x: number; y: number; w: number; h: number } | null;
}

export interface RenderCtaPlan {
  background: string;
  durationSec: number;
  zoom: boolean;
  darken: number;
  overlayPng: string;
  pointer: { png: string; x: number; y: number };
}

export interface RenderPlan {
  segments: RenderSegmentPlan[];
  cta: RenderCtaPlan | null;
  /** null = a silent stereo track (trending audio is added in Instagram). */
  music: { path: string; fadeOutSec: number; targetLufs: number } | null;
  output: string;
}

const f3 = (n: number) => (Math.round(n * 1000) / 1000).toString();
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function totalDuration(plan: RenderPlan): number {
  return plan.segments.reduce((n, s) => n + s.durationSec, 0) + (plan.cta?.durationSec ?? 0);
}

const COVER = `scale=${OUT.w}:${OUT.h}:force_original_aspect_ratio=increase,crop=${OUT.w}:${OUT.h},setsar=1`;

/**
 * One FFmpeg run: each segment trimmed (input seek on the CFR copy), scaled to cover and
 * centre-cropped, text and badge composited; the CTA from a still with a slow zoom, darkening,
 * its text and a bouncing pointer; joined with the concat filter (re-encode); audio is the
 * normalised, faded music or silence.
 */
export function buildRenderArgs(plan: RenderPlan): string[] {
  if (plan.segments.length === 0) throw new Error('Nothing to render: no segments.');
  const total = totalDuration(plan);
  const args: string[] = ['-hide_banner', '-y'];
  const graph: string[] = [];
  const inputs: string[][] = [];
  const add = (...a: string[]) => {
    inputs.push(a);
    return inputs.length - 1;
  };

  const segIdx = plan.segments.map((s) => add('-ss', f3(s.inSec), '-t', f3(s.durationSec), '-i', s.input));
  const textIdx = plan.segments.map((s) => (s.textPng ? add('-i', s.textPng) : -1));
  const badgeIdx = plan.segments.map((s) => (s.badge ? add('-i', s.badge.png) : -1));
  const parts: string[] = [];

  plan.segments.forEach((s, k) => {
    let cur = `v${k}`;
    graph.push(`[${segIdx[k]}:v]fps=${OUT.fps},${COVER},format=yuv420p,setpts=PTS-STARTPTS[${cur}]`);
    if (textIdx[k] >= 0) {
      graph.push(`[${cur}][${textIdx[k]}:v]overlay=0:0[${cur}t]`);
      cur = `${cur}t`;
    }
    if (s.badge && badgeIdx[k] >= 0) {
      graph.push(`[${badgeIdx[k]}:v]scale=${even(s.badge.w)}:${even(s.badge.h)}[b${k}]`);
      graph.push(`[${cur}][b${k}]overlay=${Math.round(s.badge.x)}:${Math.round(s.badge.y)}[${cur}b]`);
      cur = `${cur}b`;
    }
    graph.push(`[${cur}]trim=duration=${f3(s.durationSec)},setpts=PTS-STARTPTS,format=yuv420p,settb=AVTB[s${k}]`);
    parts.push(`[s${k}]`);
  });

  if (plan.cta) {
    const c = plan.cta;
    const bg = add('-loop', '1', '-framerate', String(OUT.fps), '-t', f3(c.durationSec), '-i', c.background);
    const text = add('-i', c.overlayPng);
    const pointer = add('-i', c.pointer.png);
    // Zoompan on a 2× upscale avoids the jitter of integer crop offsets.
    const motion = c.zoom
      ? `scale=${OUT.w * 2}:${OUT.h * 2},zoompan=z='min(1+0.0007*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OUT.w}x${OUT.h}:fps=${OUT.fps}`
      : `fps=${OUT.fps}`;
    // The still is a full-range JPEG: convert to TV range so the whole Reel is plain yuv420p.
    graph.push(`[${bg}:v]scale=in_range=pc:out_range=tv,format=yuv420p,${COVER},${motion},drawbox=x=0:y=0:w=iw:h=ih:color=black@${c.darken}:t=fill,format=yuv420p[c0]`);
    graph.push(`[c0][${text}:v]overlay=0:0[c1]`);
    graph.push(`[c1][${pointer}:v]overlay=x=${c.pointer.x}:y='${c.pointer.y}+14*sin(2*PI*1.4*t)'[c2]`);
    graph.push(`[c2]trim=duration=${f3(c.durationSec)},setpts=PTS-STARTPTS,format=yuv420p,settb=AVTB[cta]`);
    parts.push('[cta]');
  }
  graph.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0,format=yuv420p[vout]`);

  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  if (plan.music) {
    const m = add('-i', plan.music.path);
    const fade = Math.min(plan.music.fadeOutSec, total / 2);
    graph.push(
      `[${m}:a]loudnorm=I=${plan.music.targetLufs}:TP=-1.5:LRA=11,aresample=48000,${aformat},apad,atrim=0:${f3(total)},afade=t=out:st=${f3(total - fade)}:d=${f3(fade)}[aout]`,
    );
  } else {
    const a = add('-f', 'lavfi', '-t', f3(total), '-i', 'anullsrc=r=48000:cl=stereo');
    graph.push(`[${a}:a]${aformat},atrim=0:${f3(total)}[aout]`);
  }

  for (const i of inputs) args.push(...i);
  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-r',
    String(OUT.fps),
    '-g',
    String(OUT.fps * 2),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-t',
    f3(total),
    plan.output,
  );
  return args;
}

/** Seconds where each segment (and the CTA) starts in the final video. */
export function joinTimes(plan: RenderPlan): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of plan.segments.slice(0, -1)) {
    t += s.durationSec;
    out.push(Math.round(t * 1000) / 1000);
  }
  if (plan.cta) out.push(Math.round(plan.segments.reduce((n, s) => n + s.durationSec, 0) * 1000) / 1000);
  return out;
}
