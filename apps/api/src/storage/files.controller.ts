import fs from 'node:fs';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from './storage.service';

@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get('*path')
  serve(@Param('path') segments: string | string[], @Res() res: Response): void {
    const rel = (Array.isArray(segments) ? segments.join('/') : segments).replace(/^\/+/, '');
    const abs = this.storage.abs(rel);
    if (rel.startsWith('tmp/') || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new NotFoundException('File not found');
    }
    // Paths embed ids or timestamps, so contents at a path never change.
    res.sendFile(abs, { maxAge: '7d', immutable: true });
  }
}
