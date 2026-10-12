import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETTINGS } from '@reel/shared';
import { renderBadge, renderCtaOverlay, renderTextOverlay } from '../src/overlay/render';
import { blackdetectArgs, parseBlackdetect, parseFinalProbe, qaChecks } from '../src/render/qa';
import { buildRenderArgs, joinTimes, totalDuration, type RenderPlan } from '../src/render/render-args';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const CLIPS = path.join(__dirname, 'fixtures', 'clips');
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0 && spawnSync(FFPROBE, ['-version']).status === 0;

function run(bin: string, args: string[]): { stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr.slice(-2000)}`);
  return { stdout: r.stdout, stderr: r.stderr };
}

/**
 * Renders a short Reel from the 3 bundled sample clips (a 24 fps vertical clip, a square clip that
 * must be cropped, and one with an audio track that must be dropped) with text, badge and CTA
 * overlays, then checks the output with ffprobe and blackdetect.
 */
describe.skipIf(!hasFfmpeg)('render integration (FFmpeg)', () => {
  let dir: string;
  let plan: RenderPlan;
  let badgeRect: { x: number; y: number; w: number; h: number };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-render-'));
    const zone = SETTINGS['overlay.safeZone'].default;
    const write = (name: string, data: Buffer) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, data);
      return file;
    };
    const texts = ['Daily wear unboxing 📦', 'Pale teal, not boring 🩵', 'Thread and bead neck yoke 😍'];
    const textPngs = texts.map((t, i) => write(`text-${i}.png`, renderTextOverlay(t, zone).png));
    const badge = await renderBadge({ logoPath: null, label: '₹1,499' });
    const badgePng = write('badge.png', badge.png);
    badgeRect = { x: 1080 - 48 - badge.w, y: 300, w: badge.w, h: badge.h };
    const cta = renderCtaOverlay("Comment LINK and I'll DM you the link 👇", zone);
    const background = path.join(dir, 'cta-bg.png');
    run(FFMPEG, ['-hide_banner', '-y', '-sseof', '-0.2', '-i', path.join(CLIPS, 'clip-c-720x1280-30fps-audio.mp4'), '-frames:v', '1', background]);

    plan = {
      segments: [
        { input: path.join(CLIPS, 'clip-a-720x1280-24fps.mp4'), inSec: 0.1, durationSec: 4.5, textPng: textPngs[0], badge: null },
        {
          input: path.join(CLIPS, 'clip-b-1080x1080-30fps.mp4'),
          inSec: 0.2,
          durationSec: 4.5,
          textPng: textPngs[1],
          badge: { png: badgePng, ...badgeRect },
        },
        { input: path.join(CLIPS, 'clip-c-720x1280-30fps-audio.mp4'), inSec: 0, durationSec: 4.5, textPng: textPngs[2], badge: null },
      ],
      cta: {
        background,
        durationSec: 3,
        zoom: true,
        darken: 0.35,
        overlayPng: write('cta.png', cta.png),
        pointer: { png: write('pointer.png', cta.pointer.png), x: cta.pointer.x, y: cta.pointer.y },
      },
      music: null,
      output: path.join(dir, 'final.mp4'),
    };
    run(FFMPEG, buildRenderArgs(plan));
  }, 180_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produces a Reels-spec file of the planned length', () => {
    const probe = parseFinalProbe(run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', plan.output]).stdout);
    expect(probe).toMatchObject({ width: 1080, height: 1920, codec: 'h264', profile: 'High', pixFmt: 'yuv420p', audioCodec: 'aac', sampleRate: 48000, channels: 2 });
    expect(probe.fps).toBeCloseTo(30, 1);
    expect(totalDuration(plan)).toBe(16.5);
    expect(probe.durationSec).toBeGreaterThan(16.3);
    expect(probe.durationSec).toBeLessThan(16.7);
    const failed = qaChecks(probe, totalDuration(plan)).filter((c) => !c.ok);
    expect(failed).toEqual([]);
  });

  it('has no black frames at the joins', () => {
    const { stderr } = run(FFMPEG, blackdetectArgs(plan.output));
    expect(parseBlackdetect(stderr, joinTimes(plan))).toEqual([]);
  });

  it('composites the overlays: the frame differs from the plain clip', () => {
    // Middle of segment 2 (the square clip, cropped): the top edge of the white badge pill, where the clip is green.
    const frame = path.join(dir, 'pixel.rgb');
    const x = Math.round(badgeRect.x + badgeRect.w / 2 - 4);
    const y = Math.round(badgeRect.y + 16); // below the drop-shadow margin, above the price text
    run(FFMPEG, ['-hide_banner', '-y', '-ss', '6.75', '-i', plan.output, '-frames:v', '1', '-vf', `crop=8:4:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame]);
    const [r, g, b] = fs.readFileSync(frame);
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
  });
});
