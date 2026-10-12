import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import { AssistantMessageCreateSchema } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { sendZip, type ZipEntry } from '../storyboard/zip';
import { readFixes } from './asset.mapper';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import type { StoredEditPrompt } from './edit-prompt';

@Controller()
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly assistant: AssistantService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects/:id/images')
  imagesStep(@Param('id') id: string) {
    return this.assets.imagesStep(id);
  }

  @Get('scenes/:id/assets')
  list(@Param('id') id: string) {
    return this.assets.listFor({ sceneId: id });
  }

  /** Upload one or more generated images; each gets a review job. */
  @Post('scenes/:id/assets')
  @UseInterceptors(FilesInterceptor('files'))
  upload(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.assets.upload({ sceneId: id }, files);
  }

  @Get('assets/:id')
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Post('assets/:id/review')
  review(@Param('id') id: string) {
    return this.assets.startReview(id);
  }

  @Post('assets/:id/approve')
  approve(@Param('id') id: string) {
    return this.assets.approve(id);
  }

  @Post('assets/:id/reject')
  reject(@Param('id') id: string) {
    return this.assets.reject(id);
  }

  @Delete('assets/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.assets.remove(id);
  }

  @Get('reviews/:id/fixes/:index/attachments.zip')
  async fixZip(@Param('id') id: string, @Param('index', ParseIntPipe) index: number, @Res() res: Response): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id } });
    const fix = review ? readFixes(review)[index] : undefined;
    if (!fix) throw new NotFoundException('Fix not found');
    await this.sendEditZip(res, `fix-${index + 1}`, fix);
  }

  @Get('assets/:id/assistant')
  messages(@Param('id') id: string) {
    return this.assistant.list(id);
  }

  @Post('assets/:id/assistant')
  send(
    @Param('id') id: string,
    @Body(new ZodPipe(AssistantMessageCreateSchema)) body: z.output<typeof AssistantMessageCreateSchema>,
  ) {
    return this.assistant.send(id, body.message);
  }

  @Get('assistant-messages/:id/attachments.zip')
  async messageZip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.sendEditZip(res, 'edit', await this.assistant.messageEdit(id));
  }

  /** prompt.txt plus the images renamed in attach order; files deleted since are noted in prompt.txt. */
  private async sendEditZip(res: Response, name: string, edit: StoredEditPrompt): Promise<void> {
    const entries: ZipEntry[] = [];
    const gone: string[] = [];
    for (const a of edit.attachments) {
      if (await this.storage.exists(a.path)) entries.push({ name: a.fileName, file: this.storage.abs(a.path) });
      else gone.push(a.fileName);
    }
    const missing = gone.length ? `\n\nMissing (deleted since): ${gone.join(', ')}\n` : '\n';
    entries.unshift({ name: 'prompt.txt', text: `${edit.prompt}${missing}` });
    await sendZip(res, `${name}-attachments.zip`, entries);
  }
}
