import { describe, expect, it } from 'vitest';
import { SETTINGS } from '@reel/shared';
import { FRAME_H, FRAME_W, blockedRegions, candidates, checkManual, placeBadge, sourceToOutput, type Detections } from './placement';

const zone = SETTINGS['overlay.safeZone'].default;
const badge = { w: 320, h: 104 };
const none: Detections = { faces: [], hands: [], persons: [], details: [] };
// Typical wearing shot: face upper-middle, person box full height in the centre.
const face = { x: 0.4, y: 0.16, w: 0.2, h: 0.12 };
const person = { x: 0.28, y: 0.12, w: 0.44, h: 0.8 };
const text = { x: 0.12, y: 0.36, w: 0.76, h: 0.08 };

describe('placement candidates', () => {
  it('keeps every candidate inside the safe zone', () => {
    const rects = Object.values(candidates(badge, zone));
    for (const r of rects) {
      for (const b of blockedRegions(zone)) {
        const w = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x);
        const h = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
        expect(w > 0 && h > 0).toBe(false);
      }
      expect(r.x).toBeGreaterThanOrEqual(zone.marginPx);
      expect(r.x + r.w).toBeLessThanOrEqual(FRAME_W - zone.marginPx);
      expect(r.y + r.h).toBeLessThanOrEqual(FRAME_H);
    }
  });
});

describe('placeBadge', () => {
  it('prefers the top-right corner on an empty frame', () => {
    const p = placeBadge({ badge, detections: none, textBox: text, zone });
    expect(p).toMatchObject({ anchor: 'top-right', scale: 1, warning: null, x: FRAME_W - 48 - 320 });
  });

  it('never covers the face', () => {
    const p = placeBadge({ badge, detections: { ...none, faces: [{ x: 0.6, y: 0.13, w: 0.35, h: 0.12 }], persons: [person] }, textBox: text, zone });
    expect(p.anchor).toBe('top-left');
    expect(p.warning).toBeNull();
  });

  it('avoids hands holding the product and garment detail areas', () => {
    const hands = [{ x: 0.02, y: 0.55, w: 0.3, h: 0.12 }];
    const details = [{ x: 0.6, y: 0.62, w: 0.35, h: 0.1 }];
    const faces = [{ x: 0.0, y: 0.13, w: 1, h: 0.1 }]; // blocks both top corners
    const p = placeBadge({ badge, detections: { faces, hands, persons: [], details }, textBox: text, zone });
    expect(['mid-right', 'lower-left', 'lower-right']).toContain(p.anchor);
    expect(p.anchor).not.toBe('mid-left');
  });

  it('counts the same body found on several frames once and keeps a clean corner', () => {
    const persons = Array.from({ length: 5 }, () => ({ x: 0.2, y: 0.1, w: 0.6, h: 0.85 }));
    const p = placeBadge({ badge, detections: { ...none, faces: [face], persons }, textBox: text, zone });
    expect(p.warning).toBeNull();
    expect(p.scale).toBe(1);
  });

  it('keeps the previous corner when it is still clean', () => {
    const p = placeBadge({ badge, detections: { ...none, persons: [person] }, textBox: text, zone, previous: 'top-left' });
    expect(p.anchor).toBe('top-left');
  });

  it('shrinks, then falls back with a warning when everything overlaps', () => {
    const everywhere = { x: 0, y: 0, w: 1, h: 1 };
    const p = placeBadge({ badge, detections: { ...none, faces: [everywhere] }, textBox: text, zone });
    expect(p.scale).toBe(0.8);
    expect(p.warning).toContain('least-overlapping');
  });

  it('scores a manual position', () => {
    const input = { badge, detections: { ...none, faces: [face] }, textBox: text, zone };
    expect(checkManual(input, 700, 270, 1).warning).toBeNull();
    expect(checkManual(input, 430, 330, 1).warning).toContain('face');
  });
});

describe('sourceToOutput', () => {
  it('is the identity for 9:16 sources', () => {
    expect(sourceToOutput(face, 720, 1280)).toEqual(face);
  });

  it('accounts for the centre crop of square sources', () => {
    // 1080×1080 scaled to 1920×1920, 420 px cropped each side.
    const b = sourceToOutput({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1080, 1080)!;
    expect(b.x).toBeCloseTo((0.25 * 1920 - 420) / 1080, 3);
    expect(b.y).toBeCloseTo(0.25, 3);
    expect(sourceToOutput({ x: 0, y: 0.4, w: 0.1, h: 0.1 }, 1080, 1080)).toBeNull();
  });
});
