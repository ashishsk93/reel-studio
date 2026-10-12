import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { InstructionSchema, ShotBoundsUpdateSchema, VideoJobUpdateSchema, VideoJobsGenerateSchema, VideoModeSchema } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { StorageService } from '../storage/storage.service';
import { sendZip } from '../storyboard/zip';
import { VideoAssetsService } from './video-assets.service';
import { VideoService } from './video.service';

const ReplacementSchema = z.object({ motion: z.string().trim().max(500).optional() });

@Controller()
export class VideoController {
  constructor(
    private readonly video: VideoService,
    private readonly assets: VideoAssetsService,
    private readonly storage: StorageService,
  ) {}

  /** Everything steps 5 and 6 show: jobs with prompts, uploads, reviews, and the segments. */
  @Get('projects/:id/video')
  step(@Param('id') id: string) {
    return this.assets.step(id);
  }

  @Put('projects/:id/video-mode')
  async setMode(@Param('id') id: string, @Body(new ZodPipe(VideoModeSchema)) body: z.output<typeof VideoModeSchema>) {
    await this.video.setMode(id, body.mode);
    await this.assets.syncSegments(id);
    return this.assets.step(id);
  }

  @Post('projects/:id/video-jobs/generate')
  async generate(@Param('id') id: string, @Body(new ZodPipe(VideoJobsGenerateSchema)) body: z.output<typeof VideoJobsGenerateSchema>) {
    await this.video.generate(id, body.force);
    await this.assets.syncSegments(id);
    return this.assets.step(id);
  }

  @Patch('video-jobs/:id')
  async update(@Param('id') id: string, @Body(new ZodPipe(VideoJobUpdateSchema)) body: z.output<typeof VideoJobUpdateSchema>) {
    const job = await this.video.update(id, body);
    return this.assets.step(job.projectId);
  }

  @Post('video-jobs/:id/regenerate-prompt')
  rewrite(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.video.startRewrite(id, body.instruction);
  }

  @Delete('video-jobs/:id')
  @HttpCode(204)
  async removeJob(@Param('id') id: string) {
    const job = await this.video.find(id);
    await this.video.removeJob(id);
    await this.assets.syncSegments(job.projectId);
  }

  @Get('video-jobs/:id/attachments.zip')
  async zip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const job = await this.video.find(id);
    const built = this.video.build(await this.video.context(job.projectId), job);
    const name = this.video.jobTitle(job).replace(/[^\w]+/g, '-').replace(/-+$/, '').toLowerCase();
    await sendZip(res, `${name}-attachments.zip`, [
      { name: 'prompt.txt', text: `${built.prompt}\n` },
      ...built.attachments.map((a) => ({ name: a.fileName, file: this.storage.abs(a.path) })),
    ]);
  }

  @Post('video-jobs/:id/assets')
  @UseInterceptors(FilesInterceptor('files'))
  upload(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.assets.upload(id, files);
  }

  /** "Regenerate this shot alone": a single-scene job next to the main runs. */
  @Post('scenes/:id/replacement-video-job')
  async replacement(@Param('id') id: string, @Body(new ZodPipe(ReplacementSchema)) body: z.output<typeof ReplacementSchema>) {
    const job = await this.video.createReplacement(id, body.motion);
    return { jobId: job.id };
  }

  @Put('assets/:id/shot-bounds')
  async bounds(@Param('id') id: string, @Body(new ZodPipe(ShotBoundsUpdateSchema)) body: z.output<typeof ShotBoundsUpdateSchema>) {
    await this.assets.updateBounds(id, body);
    return { ok: true };
  }

  @Post('assets/:id/shot-bounds/reset')
  async resetBounds(@Param('id') id: string) {
    await this.assets.resetBounds(id);
    return { ok: true };
  }

  @Post('assets/:id/reprocess')
  reprocess(@Param('id') id: string) {
    return this.assets.reprocess(id);
  }

  /** Exact frame as JPEG (frame-accurate preview for the timeline). */
  @Get('assets/:id/frame')
  async frame(@Param('id') id: string, @Query('t') t: string, @Res() res: Response): Promise<void> {
    const file = await this.assets.frame(id, Number(t) || 0);
    res.sendFile(file, { maxAge: '7d', immutable: true });
  }

  @Get('reviews/:id/video-fixes/:index/attachments.zip')
  async fixZip(@Param('id') id: string, @Param('index', ParseIntPipe) index: number, @Res() res: Response): Promise<void> {
    const built = await this.assets.fixZipData(id, index);
    await sendZip(res, `shot-fix-${index + 1}-attachments.zip`, [
      { name: 'prompt.txt', text: `${built.prompt}\n` },
      ...built.attachments.map((a) => ({ name: a.fileName, file: this.storage.abs(a.path) })),
    ]);
  }
}
