import fs from 'node:fs/promises';
import sharp from 'sharp';

export const MAX_LONG_EDGE = 1568;
export const JPEG_QUALITY = 85;

export interface PreparedImage {
  base64: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

const cache = new Map<string, PreparedImage>();
const CACHE_LIMIT = 64;

/**
 * Downscales so the long edge is at most 1568 px and re-encodes as JPEG q85 for the API.
 * Applies EXIF rotation and flattens transparency onto white. Originals on disk are untouched.
 */
export async function prepareImage(absPath: string): Promise<PreparedImage> {
  const stat = await fs.stat(absPath);
  const key = `${absPath}:${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { data, info } = await sharp(absPath)
    .rotate()
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const prepared: PreparedImage = {
    base64: data.toString('base64'),
    mediaType: 'image/jpeg',
    width: info.width,
    height: info.height,
    bytes: data.length,
  };
  cache.set(key, prepared);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return prepared;
}
