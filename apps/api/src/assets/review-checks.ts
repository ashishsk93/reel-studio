import type { Box, ReviewIssue, Verdict } from '@reel/shared';

/** "9:16" → 0.5625 */
export function parseAspect(aspect: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!m) return null;
  const ratio = Number(m[1]) / Number(m[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** Flags images whose width/height is more than 3% off the expected aspect ratio. */
export function aspectIssue(width: number, height: number, expected: string): ReviewIssue | null {
  const want = parseAspect(expected);
  if (!want || !width || !height) return null;
  const got = width / height;
  if (Math.abs(got - want) / want <= 0.03) return null;
  return {
    severity: 'major',
    description: `The image is ${width}×${height} (${got.toFixed(2)}), not ${expected}. Regenerate at ${expected} or crop it before animating.`,
    region: null,
  };
}

/** Instagram covers the top and bottom of a Reel with its interface; the face must stay clear of both. */
export function faceZoneIssue(face: Box | null, zone: { top: number; bottom: number }): ReviewIssue | null {
  if (!face) return null;
  const parts: string[] = [];
  if (face.y < zone.top) parts.push(`top ${Math.round(zone.top * 100)}%`);
  if (face.y + face.h > 1 - zone.bottom) parts.push(`bottom ${Math.round(zone.bottom * 100)}%`);
  if (parts.length === 0) return null;
  return {
    severity: 'major',
    description: `Her face reaches into the ${parts.join(' and ')} of the frame, which Instagram covers with its interface. Reframe so her face sits in the upper middle.`,
    region: face,
  };
}

/** App-side issues can only make a verdict stricter. */
export function adjustVerdict(verdict: Verdict, added: ReviewIssue[]): Verdict {
  if (added.some((i) => i.severity === 'critical')) return 'fail';
  if (verdict === 'pass' && added.some((i) => i.severity === 'major')) return 'warn';
  return verdict;
}
