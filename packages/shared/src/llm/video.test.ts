import { describe, expect, it } from 'vitest';
import { videoPromptChecked, videoReviewChecked, type VideoReviewOutput } from './video.js';

const shot = (n: number, verdict: 'pass' | 'warn' | 'fail' = 'pass') => ({
  shot: n,
  verdict,
  matchesScene: true,
  notes: 'Face and garment hold.',
  issues: [],
  usableFrom: null,
  usableTo: null,
});

const base: VideoReviewOutput = { verdict: 'pass', summary: 'Clean.', shots: [shot(1), shot(2)], fixes: [] };
const messages = (value: unknown) => {
  const r = videoReviewChecked({ shotCount: 2, durationSec: 6 }).safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('videoReviewChecked', () => {
  it('accepts a consistent review', () => {
    expect(messages(base)).toEqual([]);
  });

  it('needs one entry per shot, in order', () => {
    expect(messages({ ...base, shots: [shot(1)] })[0]).toContain('Review shots 1, 2');
  });

  it('keeps usable windows inside the video and ordered', () => {
    expect(messages({ ...base, shots: [{ ...shot(1), usableTo: 7 }, shot(2)] })[0]).toContain('within 0-6s');
    expect(messages({ ...base, shots: [{ ...shot(1), usableFrom: 2, usableTo: 1 }, shot(2)] })[0]).toContain('before usableTo');
  });

  it('keeps the verdict consistent and requires fixes', () => {
    const failed = { ...base, shots: [shot(1, 'fail'), shot(2)] };
    expect(messages(failed)).toContain('A failed shot or a major/critical issue cannot be a pass');
    expect(messages({ ...failed, verdict: 'fail' })).toContain('Give at least one fix for warn or fail');
    const fix = { shot: null, kind: 'regenerate_shot' as const, title: 'Redo', instruction: 'Regenerate it', motion: null };
    expect(messages({ ...failed, verdict: 'fail', fixes: [fix] })).toContain('regenerate_shot needs a shot number');
    expect(messages({ ...failed, verdict: 'fail', fixes: [{ ...fix, shot: 1 }] })).toEqual([]);
  });
});

describe('videoPromptChecked', () => {
  it('requires shot markers verbatim', () => {
    const schema = videoPromptChecked(['Shot 1 (0–3s):', 'Shot 2 (3–6s):']);
    expect(schema.safeParse({ prompt: 'Shot 1 (0–3s): a. Hard cut.\nShot 2 (3–6s): b.' }).success).toBe(true);
    expect(schema.safeParse({ prompt: 'Shot 1 (0–3s): a. Shot 2 (3-6 s): b.' }).success).toBe(false);
  });
});
