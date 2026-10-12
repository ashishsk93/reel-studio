import { describe, expect, it } from 'vitest';
import { adjustVerdict, aspectIssue, faceZoneIssue, parseAspect } from './review-checks';

describe('aspectIssue', () => {
  it('accepts 9:16 within 3%', () => {
    expect(parseAspect('9:16')).toBeCloseTo(0.5625);
    expect(aspectIssue(1080, 1920, '9:16')).toBeNull();
    expect(aspectIssue(1088, 1920, '9:16')).toBeNull();
  });

  it('flags square and landscape images', () => {
    expect(aspectIssue(1024, 1024, '9:16')?.severity).toBe('major');
    expect(aspectIssue(1920, 1080, '16:9')).toBeNull();
    expect(aspectIssue(1080, 1920, '16:9')?.description).toContain('not 16:9');
  });
});

describe('faceZoneIssue', () => {
  const zone = { top: 0.13, bottom: 0.22 };
  it('passes a face in the upper middle', () => {
    expect(faceZoneIssue({ x: 0.4, y: 0.2, w: 0.2, h: 0.15 }, zone)).toBeNull();
    expect(faceZoneIssue(null, zone)).toBeNull();
  });
  it('flags faces under the top bar or the bottom caption area', () => {
    expect(faceZoneIssue({ x: 0.4, y: 0.05, w: 0.2, h: 0.15 }, zone)?.description).toContain('top 13%');
    expect(faceZoneIssue({ x: 0.4, y: 0.7, w: 0.2, h: 0.15 }, zone)?.description).toContain('bottom 22%');
  });
});

describe('adjustVerdict', () => {
  it('only ever makes the verdict stricter', () => {
    const major = { severity: 'major' as const, description: '', region: null };
    expect(adjustVerdict('pass', [major])).toBe('warn');
    expect(adjustVerdict('fail', [major])).toBe('fail');
    expect(adjustVerdict('warn', [{ ...major, severity: 'critical' }])).toBe('fail');
    expect(adjustVerdict('pass', [])).toBe('pass');
  });
});
