import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import sharp from 'sharp';
import { StorageService } from './storage.service';
import { StorageModule } from './storage.module';

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

/** Multer writes uploads straight into DATA_DIR/tmp; handlers rename them into place. */
export function uploadsModule(options: { maxBytes?: number; files?: number } = {}) {
  return MulterModule.registerAsync({
    imports: [StorageModule],
    inject: [StorageService],
    useFactory: (storage: StorageService) => ({
      storage: diskStorage({
        destination: storage.tmpDir,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: options.maxBytes ?? MAX_IMAGE_BYTES, files: options.files ?? 30 },
    }),
  });
}

export interface ImageInfo {
  format: 'jpeg' | 'png' | 'webp';
  ext: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  hasAlpha: boolean;
}

const EXT: Record<ImageInfo['format'], ImageInfo['ext']> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** Validates by decoding the header, not by trusting the extension or MIME type. */
export async function inspectImage(absPath: string, originalName: string): Promise<ImageInfo> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(absPath).metadata();
  } catch {
    throw new BadRequestException(`${originalName} is not a readable image.`);
  }
  const format = meta.format;
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
    throw new BadRequestException(`${originalName}: only JPEG, PNG and WebP images are accepted (got ${format ?? 'unknown'}).`);
  }
  if (!meta.width || !meta.height) throw new BadRequestException(`${originalName} has no dimensions.`);
  // EXIF orientations 5–8 rotate by 90°, so the displayed size is swapped.
  const rotated = (meta.orientation ?? 1) >= 5;
  return {
    format,
    ext: EXT[format],
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}

/** Image tools reject attachments below 300 px (Higgsfield); small listing photos are upscaled to this short side. */
export const MIN_ATTACHMENT_SIDE = 512;
export const UPSCALED_SHORT_SIDE = 768;

/**
 * Upscales a small image in place (Lanczos) so its short side is UPSCALED_SHORT_SIDE, keeping the
 * format; EXIF rotation is applied. Returns the new info, and the original size when it changed.
 */
export async function upscaleIfSmall(absPath: string, info: ImageInfo): Promise<ImageInfo & { upscaledFrom: { width: number; height: number } | null }> {
  const short = Math.min(info.width, info.height);
  if (short >= MIN_ATTACHMENT_SIDE) return { ...info, upscaledFrom: null };
  const scale = UPSCALED_SHORT_SIDE / short;
  const width = Math.round(info.width * scale);
  const height = Math.round(info.height * scale);
  const pipeline = sharp(absPath).rotate().resize({ width, height, kernel: 'lanczos3' });
  const out = await (info.format === 'png' ? pipeline.png() : info.format === 'webp' ? pipeline.webp({ quality: 95 }) : pipeline.jpeg({ quality: 95 })).toBuffer();
  await (await import('node:fs/promises')).writeFile(absPath, out);
  return { ...info, width, height, upscaledFrom: { width: info.width, height: info.height } };
}
