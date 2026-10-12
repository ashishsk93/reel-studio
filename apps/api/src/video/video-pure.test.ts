import { describe, expect, it } from 'vitest';
import { SETTINGS } from '@reel/shared';
import { PromptService } from '../llm/prompt.service';
import { boundsIssues, mapCuts, parseSceneScores, planFrameTimes, suggestWindow } from './cuts';
import { framesArgs, normalizeArgs, parseProbe, probeArgs, sceneCutArgs, frameAtArgs } from './ffmpeg';
import { creditEstimate, planMultiShot, planSingle, shotLength, type PlanScene } from './plan';
import { buildMultiShotPrompt, buildSinglePrompt, shotMarker } from './video-prompt';

const options = { maxSec: 15, minSec: 3, paddingSec: 0.5, singleSec: 5 };
const scene = (order: number, setting: string, outfitState: string, targetDurationSec = 2.5): PlanScene => ({
  id: `s${order}`,
  order,
  setting,
  outfitState,
  targetDurationSec,
  onScreenText: `text ${order}`,
});

describe('video plan', () => {
  const scenes = [
    scene(0, 'Her bedroom', 'own_clothes'),
    scene(1, 'her  bedroom', 'own_clothes'),
    scene(2, 'Her bedroom', 'own_clothes', 3),
    scene(3, 'Balcony at dusk', 'wearing_product'),
    scene(4, 'Balcony at dusk', 'wearing_product', 3),
  ];

  it('rounds shot lengths up to half seconds with padding', () => {
    expect(shotLength(2.5, 0.5, 15)).toBe(3);
    expect(shotLength(2.2, 0.5, 15)).toBe(3);
    expect(shotLength(20, 0.5, 15)).toBe(15);
  });

  it('groups consecutive scenes by setting and outfit into runs of at most 15 s', () => {
    const jobs = planMultiShot(scenes, options);
    expect(jobs.map((j) => j.sceneIds)).toEqual([['s0', 's1', 's2'], ['s3', 's4']]);
    expect(jobs[0].durationSec).toBe(10);
    expect(jobs[0].expectedShots.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 6], [6, 10]]);
    expect(jobs[1].expectedShots.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 7]]);
  });

  it('treats settings with extra shot details as the same place', () => {
    const jobs = planMultiShot(
      [
        scene(0, 'Her cosy bedroom with a cream curtain, morning light', 'own_clothes'),
        scene(1, 'Her cosy bedroom with a cream curtain, the pants laid flat on the bed', 'own_clothes'),
        scene(2, 'Her cosy bedroom with a cream curtain, close view of the kurta', 'wearing_product'),
        scene(3, 'A balcony at dusk, a low railing', 'wearing_product'),
      ],
      options,
    );
    expect(jobs.map((j) => j.sceneIds)).toEqual([['s0', 's1'], ['s2'], ['s3']]);
  });

  it('splits a run that would exceed the limit', () => {
    const long = Array.from({ length: 6 }, (_, i) => scene(i, 'room', 'own_clothes', 2.5));
    const jobs = planMultiShot(long, options);
    expect(jobs.map((j) => j.sceneIds.length)).toEqual([5, 1]);
    expect(jobs[0].durationSec).toBe(15);
    expect(jobs[1].durationSec).toBe(3);
  });

  it('plans one 5 s generation per scene in single mode', () => {
    const jobs = planSingle(scenes, options);
    expect(jobs).toHaveLength(5);
    expect(jobs[0].durationSec).toBe(5);
    expect(jobs[0].expectedShots[0]).toMatchObject({ start: 0, end: 5, targetSec: 2.5 });
  });

  it('estimates credits per 5 s', () => {
    expect(creditEstimate(10, 6.25)).toBe(12.5);
    expect(creditEstimate(7, 6.25)).toBe(8.75);
  });
});

describe('cuts', () => {
  it('parses scene scores from metadata=print output', () => {
    const stderr = [
      '[Parsed_metadata_1 @ 000001] frame:96   pts:96      pts_time:3.2',
      '[Parsed_metadata_1 @ 000001] lavfi.scene_score=0.201506',
      'frame=  5 fps=0.0',
      '[Parsed_metadata_1 @ 000001] frame:180  pts:180     pts_time:6',
      '[Parsed_metadata_1 @ 000001] lavfi.scene_score=0.058939',
    ].join('\n');
    expect(parseSceneScores(stderr)).toEqual([
      { t: 3.2, score: 0.201506 },
      { t: 6, score: 0.058939 },
    ]);
  });

  const expected = [
    { sceneId: 'a', start: 0, end: 3 },
    { sceneId: 'b', start: 3, end: 6 },
    { sceneId: 'c', start: 6, end: 10 },
  ];

  it('maps detected cuts to the nearest planned boundary', () => {
    const bounds = mapCuts(expected, [3.1, 5.8, 8.9].map((t) => ({ t, score: 0.6 })), 10);
    expect(bounds.map((b) => [b.start, b.end, b.matched])).toEqual([
      [0, 3.1, true],
      [3.1, 5.8, true],
      [5.8, 10, true],
    ]);
  });

  it('uses a weaker change only close to the plan', () => {
    const bounds = mapCuts(expected, [{ t: 3.2, score: 0.2 }, { t: 7, score: 0.2 }, { t: 6.05, score: 0.9 }], 10);
    expect(bounds.map((b) => [b.start, b.matched])).toEqual([[0, true], [3.2, true], [6.067, true]]);
  });

  it('falls back to the scaled plan when a cut is missing', () => {
    const bounds = mapCuts(expected, [{ t: 6.6, score: 0.5 }], 11);
    expect(bounds[1]).toMatchObject({ start: 3.3, matched: false });
    expect(bounds[2]).toMatchObject({ start: 6.6, end: 11, matched: true });
  });

  it('suggests the earliest clean window of the target length, avoiding the tail', () => {
    expect(suggestWindow({ start: 3, end: 6 }, 2.5)).toEqual({ inSec: 3.1, outSec: 5.6 });
    expect(suggestWindow({ start: 0, end: 2 }, 2.5)).toEqual({ inSec: 0.1, outSec: 1.7 });
    expect(suggestWindow({ start: 0, end: 5 }, 2.5, { usableFrom: 1, usableTo: 2.6 })).toEqual({ inSec: 1, outSec: 2.6 });
  });

  it('plans review frames: midpoints, around cuts, ends, capped sampling', () => {
    const times = planFrameTimes(10, [{ start: 0, end: 3 }, { start: 3, end: 10 }], [3]);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(9.967, 3);
    expect(times).toEqual(expect.arrayContaining([1.5, 2.867, 3.167, 6.5]));
    expect(times.length).toBeLessThanOrEqual(30);
    expect(new Set(times).size).toBe(times.length);
  });

  it('validates hand-edited bounds', () => {
    const good = [
      { sceneId: 'a', start: 0, end: 3, inSec: 0.1, outSec: 2.6 },
      { sceneId: 'b', start: 3, end: 6, inSec: 3.1, outSec: 5.6 },
    ];
    expect(boundsIssues(good, ['a', 'b'], 6)).toEqual([]);
    expect(boundsIssues([good[0], { ...good[1], start: 3.5 }], ['a', 'b'], 6)[0]).toContain('must start where shot 1 ends');
    expect(boundsIssues([good[0], { ...good[1], outSec: 6.5 }], ['a', 'b'], 6)[0]).toContain('inside the shot');
  });
});

describe('ffmpeg builders', () => {
  it('builds stable argument lists', () => {
    expect(probeArgs('in.mp4')).toMatchSnapshot();
    expect(normalizeArgs('in.mov', 'out.mp4')).toMatchSnapshot();
    expect(sceneCutArgs('n.mp4', 0.3)).toMatchSnapshot();
    expect(framesArgs('n.mp4', [0, 45, 299], 'f_%03d.jpg')).toMatchSnapshot();
    expect(frameAtArgs('n.mp4', 1.5, 'p.jpg')).toMatchSnapshot();
  });

  it('parses ffprobe output, handling rotation and variable frame rate', () => {
    const probe = parseProbe(
      JSON.stringify({
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '30/1', avg_frame_rate: '2997/100', side_data_list: [{ rotation: -90 }] },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
        format: { duration: '10.0333' },
      }),
    );
    expect(probe).toEqual({ width: 720, height: 1280, fps: 29.97, durationSec: 10.033, codec: 'h264', hasAudio: true, vfr: false, rotation: 270 });
    expect(() => parseProbe(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toThrow('No video stream');
  });
});

describe('video prompts', () => {
  const template = SETTINGS['video.multiShotTemplate'].default;

  it('builds the multi-shot prompt with markers, cuts and the consistency footer', () => {
    const prompt = buildMultiShotPrompt(template, {
      name: 'Aanya Kapoor',
      forbiddenFeatures: ['no nose ring or nose piercing'],
      shots: [
        { start: 0, end: 3, description: 'she holds the courier pouch up to the camera', motion: 'she smiles and tilts the pouch' },
        { start: 3, end: 5.5, description: 'she holds the kurta against herself', motion: 'the fabric settles' },
      ],
    });
    const lines = prompt.split('\n');
    expect(lines[0]).toBe('Shot 1 (0–3s): She holds the courier pouch up to the camera. She smiles and tilts the pouch. Hard cut.');
    expect(lines[1]).toBe('Shot 2 (3–5.5s): She holds the kurta against herself. The fabric settles.');
    expect(prompt).toContain("Aanya's face and hair stay identical across all shots, with no nose ring or nose piercing.");
    expect(shotMarker(2, { start: 3, end: 5.5 })).toBe('Shot 2 (3–5.5s):');
  });

  it('reports a broken template instead of crashing', () => {
    expect(() =>
      buildMultiShotPrompt({ ...template, shotLine: 'Shot {{index}} {{unknown}}' }, { name: 'A', forbiddenFeatures: [], shots: [{ start: 0, end: 3, description: 'x', motion: 'y' }] }),
    ).toThrow('shot line template');
  });

  it('builds the single-scene prompt', () => {
    const prompt = buildSinglePrompt({ name: 'Meera Nair', forbiddenFeatures: [], motion: 'she slowly lifts the kurta and smiles' }, new PromptService());
    expect(prompt).toBe(
      "Static, locked-off camera. She slowly lifts the kurta and smiles. Meera's face and hair stay the same, and the outfit stays exactly the same in every frame: same colour, pattern, neckline, length and cut. Subtle, realistic motion only, photorealistic.",
    );
  });
});
