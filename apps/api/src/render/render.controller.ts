import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { safeName, sendZip } from '../storyboard/zip';
import { RenderService } from './render.service';

@Controller()
export class RenderController {
  constructor(
    private readonly renders: RenderService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('projects/:id/renders')
  start(@Param('id') id: string) {
    return this.renders.start(id);
  }

  @Get('projects/:id/renders')
  list(@Param('id') id: string) {
    return this.renders.list(id);
  }

  /** final.mp4, covers, caption, DM template, contact sheet and QA report. */
  @Get('renders/:id/export.zip')
  async zip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const render = await this.renders.find(id);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: render.projectId } });
    const files = await this.renders.files(render);
    await sendZip(res, `${safeName(project.title)}-reel.zip`, files.map((f) => ({ name: f.name, file: this.storage.abs(f.rel) })));
  }
}
