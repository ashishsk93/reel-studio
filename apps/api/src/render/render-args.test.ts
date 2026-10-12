import { describe, expect, it } from 'vitest';
import { blackdetectArgs, parseBlackdetect, parseFinalProbe, progressSeconds, qaChecks } from './qa';
import { buildRenderArgs, joinTimes, totalDuration, type RenderPlan } from './render-args';

const plan: RenderPlan = {
  segments: [
    { input: 'a.mp4', inSec: 0.1, durationSec: 2.5, textPng: 't0.png', badge: null },
    { input: 'b.mp4', inSec: 3.1, durationSec: 2.5, textPng: 't1.png', badge: { png: 'badge.png', x: 712, y: 298, w: 337.6, h: 125 } },
    { input: 'b.mp4', inSec: 6.2, durationSec: 3, textPng: null, badge: null },
  ],
  cta: { background: 'bg.jpg', durationSec: 3, zoom: true, darken: 0.35, overlayPng: 'cta.png', pointer: { png: 'ptr.png', x: 465, y: 1050 } },
  music: null,
  output: 'final.mp4',
};

describe('render args', () => {
  it('builds the full FFmpeg command', () => {
    expect(buildRenderArgs(plan)).toMatchSnapshot();
  });

  it('uses normalised, faded music when given', () => {
    const args = buildRenderArgs({ ...plan, music: { path: 'song.mp3', fadeOutSec: 2, targetLufs: -14 } });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('loudnorm=I=-14');
    expect(graph).toContain('afade=t=out:st=9:d=2');
    expect(args).not.toContain('anullsrc=r=48000:cl=stereo');
  });

  it('computes durations and join times', () => {
    expect(totalDuration(plan)).toBe(11);
    expect(joinTimes(plan)).toEqual([2.5, 5, 8]);
  });

  it('trims every segment and concatenates segments plus the CTA', () => {
    const graph = buildRenderArgs(plan)[buildRenderArgs(plan).indexOf('-filter_complex') + 1];
    expect(graph).toContain('[s0][s1][s2][cta]concat=n=4:v=1:a=0');
    expect(graph).toContain('scale=338:126[b1]');
    expect(graph).toContain("overlay=x=465:y='1050+14*sin(2*PI*1.4*t)'");
  });
});

describe('qa', () => {
  const probe = parseFinalProbe(
    JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: 1080, height: 1920, r_frame_rate: '30/1', avg_frame_rate: '30/1' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      ],
      format: { duration: '17.000000' },
    }),
  );

  it('passes a spec-compliant render', () => {
    expect(qaChecks(probe, 17).every((c) => c.ok)).toBe(true);
  });

  it('flags a wrong length and missing audio', () => {
    const checks = qaChecks({ ...probe, durationSec: 22, audioCodec: null, sampleRate: null, channels: null }, 17);
    expect(checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(['AAC 48 kHz stereo', 'Duration as planned', 'Reel length 16–20 s']);
  });

  it('finds black frames near joins', () => {
    const stderr = '[blackdetect @ 0x1] black_start:2.45 black_end:2.6 black_duration:0.15\n[blackdetect @ 0x1] black_start:9 black_end:9.2 black_duration:0.2';
    expect(parseBlackdetect(stderr, [2.5, 5])).toEqual([
      { start: 2.45, end: 2.6, nearJoin: true },
      { start: 9, end: 9.2, nearJoin: false },
    ]);
    expect(blackdetectArgs('f.mp4')).toContain('blackdetect=d=0.05:pix_th=0.10');
  });

  it('reads FFmpeg progress', () => {
    expect(progressSeconds('frame=  120 fps= 40 q=28.0 size=  512kB time=00:00:04.03 bitrate=1040.0kbits/s')).toBeCloseTo(4.03);
    expect(progressSeconds('Press [q] to stop')).toBeNull();
  });
});
