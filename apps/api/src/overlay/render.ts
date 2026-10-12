import fs from 'node:fs';
import path from 'node:path';
import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { Box } from '@reel/shared';
import { FRAME_H, FRAME_W, type SafeZone } from './placement';

/** apps/api/assets/fonts (from both src/ and dist/). */
export const FONT_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');
const DISPLAY = 'Poppins ExtraBold';
const EMOJI = 'Noto Color Emoji';

export interface FontStatus {
  display: boolean;
  emoji: boolean;
  warnings: string[];
}

let fonts: FontStatus | null = null;

/** Registers Poppins ExtraBold and Noto Color Emoji once; missing fonts become render warnings. */
export function ensureFonts(dir = FONT_DIR): FontStatus {
  if (fonts) return fonts;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const poppins = files.find((f) => /^Poppins-ExtraBold\.(ttf|otf)$/i.test(f));
  const emoji = files.find((f) => /^NotoColorEmoji.*\.ttf$/i.test(f));
  const status: FontStatus = { display: false, emoji: false, warnings: [] };
  if (poppins) status.display = Boolean(GlobalFonts.registerFromPath(path.join(dir, poppins), DISPLAY));
  if (emoji) status.emoji = Boolean(GlobalFonts.registerFromPath(path.join(dir, emoji), EMOJI));
  if (!status.display) status.warnings.push(`Poppins ExtraBold not found in ${dir}; overlay text uses a fallback font.`);
  if (!status.emoji) status.warnings.push(`Noto Color Emoji not found in ${dir}; emoji may render as boxes or in black and white.`);
  fonts = status;
  return status;
}

const font = (px: number) => `${px}px "${DISPLAY}", "${EMOJI}", sans-serif`;

const EMOJI_RUN = /(\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*)/u;

export function hasEmoji(text: string): boolean {
  return EMOJI_RUN.test(text);
}

/** Splits into text and emoji runs; emoji are filled without the outline stroke. */
function runs(line: string): Array<{ text: string; emoji: boolean }> {
  return line
    .split(EMOJI_RUN)
    .filter(Boolean)
    .map((text) => ({ text, emoji: EMOJI_RUN.test(text) }));
}

/** Words, with emoji glued to the word before them so an emoji never starts a line. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (out.length && /^[\p{Extended_Pictographic}️‍\p{Emoji_Modifier}]+$/u.test(word)) out[out.length - 1] += ` ${word}`;
    else out.push(word);
  }
  return out;
}

function greedy(ctx: SKRSContext2D, words: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

/** Greedy wrap, then narrower widths until the last line isn't a lone word (same line count). */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = tokens(text);
  const base = greedy(ctx, words, maxWidth);
  if (base.length < 2 || base[base.length - 1].includes(' ')) return base;
  for (let w = maxWidth * 0.95; w >= maxWidth * 0.6; w -= maxWidth * 0.05) {
    const lines = greedy(ctx, words, w);
    if (lines.length > base.length) break;
    if (lines[lines.length - 1].includes(' ')) return lines;
  }
  return base;
}

interface Layout {
  lines: string[];
  px: number;
  lineHeight: number;
  widths: number[];
}

function layout(ctx: SKRSContext2D, text: string, maxWidth: number, sizes: number[], maxLines: number): Layout {
  for (const px of sizes) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, px, lineHeight: px * 1.18, widths: lines.map((l) => ctx.measureText(l).width) };
    }
  }
  const px = sizes[sizes.length - 1];
  ctx.font = font(px);
  const lines = wrap(ctx, text, maxWidth);
  return { lines, px, lineHeight: px * 1.18, widths: lines.map((l) => ctx.measureText(l).width) };
}

/** Bold white text with a black outline and a soft shadow, emoji in colour. */
function drawLine(ctx: SKRSContext2D, line: string, cx: number, baseline: number, px: number, width: number, highlight?: { word: string; fill: string }) {
  let x = cx - width / 2;
  ctx.font = font(px);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const run of runs(line)) {
    const w = ctx.measureText(run.text).width;
    if (run.emoji) {
      ctx.shadowColor = 'transparent';
      ctx.fillText(run.text, x, baseline);
    } else {
      const parts = highlight ? run.text.split(new RegExp(`(\\b${highlight.word}\\b)`)) : [run.text];
      for (const part of parts) {
        if (!part) continue;
        const pw = ctx.measureText(part).width;
        const isWord = highlight && part === highlight.word;
        if (isWord) {
          const padX = px * 0.22;
          x += padX; // keep the space before the pill visible
          const top = baseline - px * 0.88;
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = 14;
          ctx.fillStyle = highlight.fill;
          roundRect(ctx, x - padX, top, pw + padX * 2, px * 1.12, px * 0.3);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(part, x, baseline);
          x += padX;
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = px * 0.35;
          ctx.shadowOffsetY = px * 0.05;
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = px * 0.14;
          ctx.strokeText(part, x, baseline);
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(part, x, baseline);
        }
        x += pw;
      }
      continue;
    }
    x += w;
  }
  ctx.shadowColor = 'transparent';
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface TextOverlay {
  png: Buffer;
  /** Normalised box of the text block (for placement). */
  box: Box | null;
  warnings: string[];
}

/**
 * Full-frame transparent PNG with the segment's on-screen text: centred horizontally, block
 * centred around 40 % of the height, kept inside the safe zone.
 */
export function renderTextOverlay(text: string, zone: SafeZone, centerY = 0.4): TextOverlay {
  const status = ensureFonts();
  const canvas = createCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');
  const warnings = hasEmoji(text) && !status.emoji ? ['Emoji fallback: the colour emoji font is missing.'] : [];
  if (!status.display) warnings.push('Display font missing: text uses a fallback font.');
  if (!text.trim()) return { png: canvas.toBuffer('image/png'), box: null, warnings };

  const maxWidth = FRAME_W * 0.82;
  const l = layout(ctx, text, maxWidth, [84, 78, 72, 66, 60, 56], 3);
  if (l.lines.length > 3) warnings.push('The on-screen text is long; it wraps to more than 3 lines.');
  const blockH = l.lineHeight * l.lines.length;
  const minTop = zone.top * FRAME_H + zone.marginPx;
  const maxBottom = (1 - zone.bottom) * FRAME_H - zone.marginPx;
  const top = Math.min(Math.max(centerY * FRAME_H - blockH / 2, minTop), maxBottom - blockH);
  l.lines.forEach((line, i) => drawLine(ctx, line, FRAME_W / 2, top + l.lineHeight * i + l.px * 0.95, l.px, l.widths[i]));

  const pad = l.px * 0.25;
  const w = Math.max(...l.widths) + pad * 2;
  const box = { x: (FRAME_W - w) / 2 / FRAME_W, y: (top - pad) / FRAME_H, w: w / FRAME_W, h: (blockH + pad * 2) / FRAME_H };
  return { png: canvas.toBuffer('image/png'), box: roundBox(box), warnings };
}

const roundBox = (b: Box): Box => ({ x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h) });
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface BadgeImage {
  png: Buffer;
  w: number;
  h: number;
}

/**
 * The store logo and price in a white rounded pill (logo only for "hidden" price mode). The
 * light pill keeps dark logos readable on any footage.
 */
export async function renderBadge(input: { logoPath: string | null; label: string | null; scale?: number }): Promise<BadgeImage> {
  ensureFonts();
  const s = input.scale ?? 1;
  const h = Math.round(104 * s);
  const pad = Math.round(16 * s);
  const shadow = Math.round(10 * s);
  const fontPx = Math.round(46 * s);
  const measure = createCanvas(10, 10).getContext('2d');
  measure.font = font(fontPx);
  const labelW = input.label ? measure.measureText(input.label).width : 0;
  const logo = input.logoPath && fs.existsSync(input.logoPath) ? await loadImage(fs.readFileSync(input.logoPath)) : null;
  const logoH = h - pad * 2;
  const logoW = logo ? Math.min(logoH * (logo.width / logo.height), logoH * 2.4) : 0;
  const gap = logo && input.label ? Math.round(14 * s) : 0;
  const innerW = logoW + gap + labelW;
  const w = Math.round(Math.max(h, innerW + pad * 2 + (input.label ? h * 0.18 : 0)));

  const canvas = createCanvas(w + shadow * 2, h + shadow * 2);
  const ctx = canvas.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = Math.round(3 * s);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, shadow, shadow, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  let x = shadow + (w - innerW) / 2;
  if (logo) {
    ctx.drawImage(logo, x, shadow + pad, logoW, logoH);
    x += logoW + gap;
  }
  if (input.label) {
    ctx.font = font(fontPx);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    ctx.fillText(input.label, x, shadow + h / 2 + fontPx * 0.04);
  }
  return { png: canvas.toBuffer('image/png'), w: w + shadow * 2, h: h + shadow * 2 };
}

export interface CtaOverlay {
  png: Buffer;
  /** Bouncing pointer (the trailing 👇 or a drawn arrow) and where it sits. */
  pointer: { png: Buffer; x: number; y: number; w: number; h: number };
  warnings: string[];
}

const POINTER = /\s*(👇|⬇️|⬇)\s*$/u;

/** CTA text, larger, with LINK on a pink pill; the pointer emoji is rendered separately so it can bounce. */
export function renderCtaOverlay(text: string, zone: SafeZone): CtaOverlay {
  const status = ensureFonts();
  const warnings = hasEmoji(text) && !status.emoji ? ['Emoji fallback: the colour emoji font is missing.'] : [];
  const pointerMatch = POINTER.exec(text);
  const body = text.replace(POINTER, '');
  const canvas = createCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');
  const l = layout(ctx, body, FRAME_W * 0.84, [96, 90, 84, 78, 72], 3);
  // The LINK pill adds padding on both sides; include it so the line stays centred.
  l.widths = l.lines.map((line, i) => l.widths[i] + (/LINK/.test(line) ? l.px * 0.44 : 0));
  const blockH = l.lineHeight * l.lines.length;
  const top = Math.max(zone.top * FRAME_H + zone.marginPx, FRAME_H * 0.42 - blockH / 2);
  l.lines.forEach((line, i) =>
    drawLine(ctx, line, FRAME_W / 2, top + l.lineHeight * i + l.px * 0.95, l.px, l.widths[i], { word: 'LINK', fill: '#e6197f' }),
  );

  const size = 150;
  const pointer = createCanvas(size, size);
  const pctx = pointer.getContext('2d');
  if (pointerMatch) {
    pctx.font = font(120);
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.fillText(pointerMatch[1], size / 2, size / 2);
  } else {
    pctx.fillStyle = '#ffffff';
    pctx.shadowColor = 'rgba(0,0,0,0.5)';
    pctx.shadowBlur = 12;
    pctx.beginPath();
    pctx.moveTo(size / 2, size * 0.85);
    pctx.lineTo(size * 0.2, size * 0.45);
    pctx.lineTo(size * 0.38, size * 0.45);
    pctx.lineTo(size * 0.38, size * 0.12);
    pctx.lineTo(size * 0.62, size * 0.12);
    pctx.lineTo(size * 0.62, size * 0.45);
    pctx.lineTo(size * 0.8, size * 0.45);
    pctx.closePath();
    pctx.fill();
  }
  return {
    png: canvas.toBuffer('image/png'),
    pointer: { png: pointer.toBuffer('image/png'), x: Math.round((FRAME_W - size) / 2), y: Math.round(top + blockH + 30), w: size, h: size },
    warnings,
  };
}

/**
 * The titled cover: the plain cover with the title kept inside the centre 1080×1440 grid crop,
 * at the top of that area, or at the bottom when her face is up there.
 */
export async function renderTitledCover(plainJpg: Buffer, title: string, position: 'top' | 'bottom' = 'top'): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await loadImage(plainJpg), 0, 0, FRAME_W, FRAME_H);
  const gridTop = (FRAME_H - 1440) / 2;
  const gridBottom = gridTop + 1440;
  const l = layout(ctx, title.toUpperCase(), FRAME_W * 0.84, [104, 96, 88, 80, 72], 3);
  const blockH = l.lineHeight * l.lines.length;
  const top = position === 'top' ? gridTop + 70 : gridBottom - 70 - blockH;
  const bandTop = position === 'top' ? gridTop : top - 160;
  const bandH = blockH + 230;
  const grad = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandH);
  grad.addColorStop(position === 'top' ? 0 : 1, 'rgba(0,0,0,0.45)');
  grad.addColorStop(position === 'top' ? 1 : 0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandTop, FRAME_W, bandH);
  l.lines.forEach((line, i) => drawLine(ctx, line, FRAME_W / 2, top + l.lineHeight * i + l.px * 0.95, l.px, l.widths[i]));
  return canvas.toBuffer('image/jpeg', 90);
}
