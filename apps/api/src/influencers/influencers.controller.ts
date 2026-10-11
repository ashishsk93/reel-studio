import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  CreatorBriefSchema,
  InfluencerCreateSchema,
  InfluencerUpdateSchema,
  PersonaRegenerateSchema,
  ReferenceImageUpdateSchema,
} from '@reel/shared';
import type { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { InfluencersService } from './influencers.service';
import { PersonaService } from './persona.service';

@Controller()
export class InfluencersController {
  constructor(
    private readonly influencers: InfluencersService,
    private readonly persona: PersonaService,
  ) {}

  @Get('influencers')
  list() {
    return this.influencers.list();
  }

  @Post('influencers')
  create(@Body(new ZodPipe(InfluencerCreateSchema)) body: z.output<typeof InfluencerCreateSchema>) {
    return this.influencers.create(body);
  }

  /** Character creator: brief in, job out. The job result carries the new draft's id. */
  @Post('influencers/draft')
  draft(@Body(new ZodPipe(CreatorBriefSchema)) body: z.output<typeof CreatorBriefSchema>) {
    return this.persona.draft(body);
  }

  @Get('influencers/:id')
  get(@Param('id') id: string) {
    return this.influencers.get(id);
  }

  @Patch('influencers/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(InfluencerUpdateSchema)) body: z.output<typeof InfluencerUpdateSchema>) {
    return this.influencers.update(id, body);
  }

  @Delete('influencers/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.influencers.remove(id);
  }

  @Post('influencers/:id/activate')
  activate(@Param('id') id: string) {
    return this.influencers.activate(id);
  }

  @Post('influencers/:id/persona/regenerate')
  regenerate(
    @Param('id') id: string,
    @Body(new ZodPipe(PersonaRegenerateSchema)) body: z.output<typeof PersonaRegenerateSchema>,
  ) {
    return this.persona.regenerate(id, body.instruction);
  }

  @Post('influencers/:id/sample-prompt')
  samplePrompt(@Param('id') id: string) {
    return this.influencers.samplePrompt(id);
  }

  @Post('influencers/:id/references')
  @UseInterceptors(FilesInterceptor('files'))
  addReferences(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() fields: Record<string, unknown>,
  ) {
    return this.influencers.addReferences(id, files, fields);
  }

  @Patch('references/:id')
  updateReference(
    @Param('id') id: string,
    @Body(new ZodPipe(ReferenceImageUpdateSchema)) body: z.output<typeof ReferenceImageUpdateSchema>,
  ) {
    return this.influencers.updateReference(id, body);
  }

  @Delete('references/:id')
  @HttpCode(204)
  deleteReference(@Param('id') id: string) {
    return this.influencers.deleteReference(id);
  }
}
