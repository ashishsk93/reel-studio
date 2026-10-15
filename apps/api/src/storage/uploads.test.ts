import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { inspectImage, upscaleIfSmall } from './uploads';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('upscaleIfSmall', () => {
  it('upscales a listing thumbnail so image tools accept it (short side 768, same format and ratio)', async () => {
    const file = path.join(dir, 'thumb.png');
    await sharp({ create: { width: 262, height: 471, channels: 3, background: '#88aacc' } }).png().toFile(file);
    const out = await upscaleIfSmall(file, await inspectImage(file, 'thumb.png'));
    expect(out).toMatchObject({ width: 768, height: 1381, format: 'png', upscaledFrom: { width: 262, height: 471 } });
    const meta = await sharp(file).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([768, 1381, 'png']);
  });

  it('leaves images that are big enough alone', async () => {
    const file = path.join(dir, 'big.jpg');
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#ffffff' } }).jpeg().toFile(file);
    const before = fs.statSync(file).mtimeMs;
    const out = await upscaleIfSmall(file, await inspectImage(file, 'big.jpg'));
    expect(out.upscaledFrom).toBeNull();
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});
