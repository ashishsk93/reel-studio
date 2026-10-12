import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';

/**
 * Owns DATA_DIR. Everything stored in the DB is a forward-slash path relative to it,
 * and every write lands in tmp/ first and is renamed into place.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  readonly root: string;
  readonly tmpDir: string;
  private readonly apiOrigin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = config.dataDir;
    this.tmpDir = path.join(this.root, 'tmp');
    this.apiOrigin = config.apiOrigin;
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.tmpDir, { recursive: true });
    await fs.mkdir(path.join(this.root, 'logs'), { recursive: true });
  }

  /** Absolute path for a stored relative path; refuses anything that escapes DATA_DIR. */
  abs(rel: string): string {
    const normalized = rel.replaceAll('\\', '/').replace(/^\/+/, '');
    const resolved = path.resolve(this.root, normalized);
    const relative = path.relative(this.root, resolved);
    if (!normalized || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(`Invalid file path: ${rel}`);
    }
    return resolved;
  }

  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  /** Public URL the web app can load directly. */
  url(rel: string | null | undefined): string | null {
    if (!rel) return null;
    return `${this.apiOrigin}/api/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Absolute URL of an API route, e.g. apiUrl('/scenes/x/attachments.zip'). */
  apiUrl(route: string): string {
    return `${this.apiOrigin}/api${route}`;
  }

  async copyInto(srcRel: string, destRel: string): Promise<string> {
    const tmp = this.tmpPath(path.extname(destRel));
    await fs.copyFile(this.abs(srcRel), tmp);
    return this.moveInto(tmp, destRel);
  }

  tmpPath(ext = ''): string {
    return path.join(this.tmpDir, `${randomUUID()}${ext}`);
  }

  /** Moves a temp file into DATA_DIR at `rel`, creating folders as needed. */
  async moveInto(tmpAbs: string, rel: string): Promise<string> {
    const dest = this.abs(rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(tmpAbs, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.copyFile(tmpAbs, dest);
      await fs.unlink(tmpAbs);
    }
    return rel;
  }

  async writeAtomic(rel: string, data: string | Uint8Array): Promise<string> {
    const tmp = this.tmpPath(path.extname(rel));
    await fs.writeFile(tmp, data);
    return this.moveInto(tmp, rel);
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async remove(rel: string | null | undefined): Promise<void> {
    if (!rel) return;
    await fs.rm(this.abs(rel), { force: true });
  }

  async removeDir(rel: string): Promise<void> {
    await fs.rm(this.abs(rel), { recursive: true, force: true });
  }

  async discardTemp(tmpAbs: string | undefined): Promise<void> {
    if (tmpAbs) await fs.rm(tmpAbs, { force: true });
  }
}
