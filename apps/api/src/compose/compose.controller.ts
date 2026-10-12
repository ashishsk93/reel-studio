import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  CaptionsUpdateSchema,
  CoverChooseSchema,
  CtaUpdateSchema,
  SegmentComposeUpdateSchema,
  SegmentDetectionsSchema,
  type ComposeStepDto,
} from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { ComposeService } from './compose.service';
import { CoverCaptionsService } from './cover-captions.service';

@Controller()
export class ComposeController {
  constructor(
    private readonly compose: ComposeService,
    private readonly extras: CoverCaptionsService,
  ) {}

  private async step(projectId: string): Promise<ComposeStepDto> {
    return this.compose.step(projectId, {
      cover: await this.extras.coverDto(projectId),
      captions: await this.extras.captions(projectId),
    });
  }

  /** Everything step 7 shows. Placements are refreshed so overlay or setting changes apply. */
  @Get('projects/:id/compose')
  async get(@Param('id') id: string) {
    await this.compose.recomputePlacements(id);
    return this.step(id);
  }

  @Put('segments/:id/compose')
  async updateSegment(@Param('id') id: string, @Body(new ZodPipe(SegmentComposeUpdateSchema)) body: z.output<typeof SegmentComposeUpdateSchema>) {
    return this.step(await this.compose.updateSegment(id, body));
  }

  /** MediaPipe face / hand / person boxes from the browser. */
  @Post('segments/:id/detections')
  async detections(@Param('id') id: string, @Body(new ZodPipe(SegmentDetectionsSchema)) body: z.output<typeof SegmentDetectionsSchema>) {
    return this.step(await this.compose.saveDetections(id, body));
  }

  @Post('segments/:id/detail-regions')
  detailRegions(@Param('id') id: string) {
    return this.compose.startDetails(id);
  }

  @Post('segments/:id/placement/check')
  placementCheck(@Param('id') id: string) {
    return this.compose.startPlacementCheck(id);
  }

  @Get('segments/:id/preview.jpg')
  async preview(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const s = await this.compose.findSegment(id);
    res.type('jpg').send(await this.compose.compositeFrame(s, (s.inSec + s.outSec) / 2));
  }

  @Put('projects/:id/cta')
  async cta(@Param('id') id: string, @Body(new ZodPipe(CtaUpdateSchema)) body: z.output<typeof CtaUpdateSchema>) {
    await this.compose.updateCta(id, body);
    return this.step(id);
  }

  @Get('projects/:id/cta/preview.jpg')
  async ctaPreview(@Param('id') id: string, @Res() res: Response): Promise<void> {
    res.sendFile(await this.compose.ctaPreview(id), { maxAge: '7d', immutable: true });
  }

  @Post('projects/:id/cover/suggest')
  suggestCover(@Param('id') id: string) {
    return this.extras.startCover(id);
  }

  @Put('projects/:id/cover')
  async chooseCover(@Param('id') id: string, @Body(new ZodPipe(CoverChooseSchema)) body: z.output<typeof CoverChooseSchema>) {
    await this.extras.chooseCover(id, body.candidate, body.title);
    return this.step(id);
  }

  @Post('projects/:id/captions')
  captions(@Param('id') id: string) {
    return this.extras.startCaptions(id);
  }

  @Put('projects/:id/captions')
  async updateCaptions(@Param('id') id: string, @Body(new ZodPipe(CaptionsUpdateSchema)) body: z.output<typeof CaptionsUpdateSchema>) {
    await this.extras.updateCaptions(id, body);
    return this.step(id);
  }

  @Post('projects/:id/music')
  @UseInterceptors(FilesInterceptor('files'))
  async music(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    await this.compose.setMusic(id, files?.[0]);
    return this.step(id);
  }

  @Delete('projects/:id/music')
  @HttpCode(204)
  removeMusic(@Param('id') id: string) {
    return this.compose.removeMusic(id);
  }

  @Post('projects/:id/compose/complete')
  async complete(@Param('id') id: string) {
    await this.compose.complete(id);
    return { ok: true };
  }
}
