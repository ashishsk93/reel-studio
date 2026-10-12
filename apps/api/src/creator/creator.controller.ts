import { Body, Controller, Get, Param, Patch, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import { CreatorTaskUpdateSchema, InstructionSchema } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { StorageService } from '../storage/storage.service';
import { sendZip } from '../storyboard/zip';
import { CreatorService } from './creator.service';

@Controller()
export class CreatorController {
  constructor(
    private readonly creator: CreatorService,
    private readonly storage: StorageService,
  ) {}

  /** Idempotent: adds any frames that don't exist yet. */
  @Post('influencers/:id/creator/plan')
  plan(@Param('id') id: string) {
    return this.creator.plan(id);
  }

  @Get('influencers/:id/creator/tasks')
  list(@Param('id') id: string) {
    return this.creator.list(id);
  }

  @Patch('creator-tasks/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(CreatorTaskUpdateSchema)) body: z.output<typeof CreatorTaskUpdateSchema>) {
    return this.creator.update(id, body);
  }

  @Post('creator-tasks/:id/regenerate-prompt')
  rewrite(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.creator.startRewrite(id, body.instruction);
  }

  @Post('creator-tasks/:id/assets')
  @UseInterceptors(FilesInterceptor('files'))
  upload(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.creator.upload(id, files);
  }

  @Get('creator-tasks/:id/attachments.zip')
  async zip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { task, prompt, attachments } = await this.creator.attachments(id);
    await sendZip(res, `${task.tag}-attachments.zip`, [
      { name: 'prompt.txt', text: `${prompt}\n` },
      ...attachments.map((a) => ({ name: a.fileName, file: this.storage.abs(a.path) })),
    ]);
  }
}
