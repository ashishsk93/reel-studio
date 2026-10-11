import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import sharp from 'sharp';
import { StorageService } from './storage.service';
import { StorageModule } from './storage.module';

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** Multer writes uploads straight into DATA_DIR/tmp; handlers rename them into place. */
export function uploadsModule() {
  return MulterModule.registerAsync({
    imports: [StorageModule],
    inject: [StorageService],
    useFactory: (storage: StorageService) => ({
      storage: diskStorage({
        destination: storage.tmpDir,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 30 },
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
