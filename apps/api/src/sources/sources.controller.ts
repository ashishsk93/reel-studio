import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SourceUpdateSchema } from '@reel/shared';
import type { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { SourcesService } from './sources.service';

@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list() {
    return this.sources.list();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(SourceUpdateSchema)) body: z.output<typeof SourceUpdateSchema>) {
    return this.sources.update(id, body);
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file'))
  setLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.sources.setLogo(id, file);
  }

  @Delete(':id/logo')
  removeLogo(@Param('id') id: string) {
    return this.sources.removeLogo(id);
  }
}
