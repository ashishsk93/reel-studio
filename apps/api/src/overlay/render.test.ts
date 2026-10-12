import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '@reel/shared';
import { FONT_DIR, ensureFonts, hasEmoji, renderBadge, renderCtaOverlay, renderTextOverlay } from './render';

const zone = SETTINGS['overlay.safeZone'].default;
const fontsPresent = fs.existsSync(FONT_DIR) && fs.readdirSync(FONT_DIR).some((f) => /^NotoColorEmoji/i.test(f));

async function colouredPixels(png: Buffer, region?: { x: number; y: number; w: number; h: number }) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const r = region ?? { x: 0, y: 0, w: img.width, h: img.height };
  const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 80) n++;
  }
  return n;
}

describe('overlay text', () => {
  it('detects emoji runs', () => {
    expect(hasEmoji('Okay but on me 👀')).toBe(true);
    expect(hasEmoji('Kurta + matching pants')).toBe(false);
  });

  it('places the text block around 40% height inside the safe zone', () => {
    const out = renderTextOverlay('All-over thread embroidery', zone);
    expect(out.box).not.toBeNull();
    const box = out.box!;
    expect(box.y).toBeGreaterThan(zone.top);
    expect(box.y + box.h).toBeLessThan(1 - zone.bottom);
    expect(box.y + box.h / 2).toBeCloseTo(0.4, 1);
    expect(box.x + box.w / 2).toBeCloseTo(0.5, 2);
  });

  it.skipIf(!fontsPresent)('renders emoji in colour (Noto Color Emoji)', async () => {
    expect(ensureFonts().emoji).toBe(true);
    const plain = renderTextOverlay('Diwali fit unboxing', zone);
    const withEmoji = renderTextOverlay('Diwali fit unboxing 🪔', zone);
    expect(withEmoji.warnings).toEqual([]);
    // White text with a black outline has no saturated pixels; the diya emoji does.
    expect(await colouredPixels(plain.png)).toBe(0);
    expect(await colouredPixels(withEmoji.png)).toBeGreaterThan(500);
  });

  it('renders the CTA with a separate pointer and a pink LINK pill', async () => {
    const cta = renderCtaOverlay("Comment LINK and I'll DM you the link 👇", zone);
    expect(cta.pointer.y).toBeGreaterThan(800);
    expect(await colouredPixels(cta.png)).toBeGreaterThan(1000);
  });

  it('renders a badge with and without a price label', async () => {
    const logo = path.join(__dirname, '..', '..', 'test', 'fixtures', 'logo.png');
    const withPrice = await renderBadge({ logoPath: fs.existsSync(logo) ? logo : null, label: '₹1,499' });
    const smaller = await renderBadge({ logoPath: null, label: '₹1,499', scale: 0.8 });
    expect(withPrice.h).toBeGreaterThan(100);
    expect(smaller.w).toBeLessThan(withPrice.w);
  });
});
