import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  IdOrderSchema,
  InstructionSchema,
  SceneCreateSchema,
  SceneUpdateSchema,
  StoryboardGenerateSchema,
} from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StoryboardService } from './storyboard.service';
import { safeName, sendZip } from './zip';

@Controller()
export class StoryboardController {
  constructor(
    private readonly storyboard: StoryboardService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects/:id/storyboard')
  get(@Param('id') id: string) {
    return this.storyboard.get(id);
  }

  @Post('projects/:id/storyboard')
  generate(
    @Param('id') id: string,
    @Body(new ZodPipe(StoryboardGenerateSchema)) body: z.output<typeof StoryboardGenerateSchema>,
  ) {
    return this.storyboard.startGenerate(id, body.instruction, body.force);
  }

  @Post('projects/:id/scenes')
  createScene(@Param('id') id: string, @Body(new ZodPipe(SceneCreateSchema)) body: z.output<typeof SceneCreateSchema>) {
    return this.storyboard.createScene(id, body);
  }

  @Put('projects/:id/scenes/order')
  reorder(@Param('id') id: string, @Body(new ZodPipe(IdOrderSchema)) body: z.output<typeof IdOrderSchema>) {
    return this.storyboard.reorder(id, body.ids);
  }

  @Patch('scenes/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(SceneUpdateSchema)) body: z.output<typeof SceneUpdateSchema>) {
    return this.storyboard.updateScene(id, body);
  }

  @Delete('scenes/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.storyboard.deleteScene(id);
  }

  @Post('scenes/:id/regenerate-prompt')
  regenerate(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.storyboard.startRevise(id, body.instruction);
  }

  /** Attachments renamed 1_aanya_anchor.jpg, 2_product_front.jpg… so the order is unambiguous. */
  @Get('scenes/:id/attachments.zip')
  async sceneZip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { scene, attachments } = await this.storyboard.sceneAttachments(id);
    const name = `scene-${String(scene.order + 1).padStart(2, '0')}-${scene.type}-attachments.zip`;
    await sendZip(
      res,
      name,
      attachments.map((a) => ({ name: a.fileName, file: this.storage.abs(a.path) })),
    );
  }

  /** Every scene in its own folder with its prompt.txt. */
  @Get('projects/:id/storyboard.zip')
  async storyboardZip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const scenes = await this.storyboard.allAttachments(id);
    const entries = scenes.flatMap(({ scene, attachments, prompt }) => {
      const folder = `${String(scene.order + 1).padStart(2, '0')}_${scene.type}`;
      return [
        { name: `${folder}/prompt.txt`, text: `${prompt}\n` },
        ...attachments.map((a) => ({ name: `${folder}/${a.fileName}`, file: this.storage.abs(a.path) })),
      ];
    });
    await sendZip(res, `${safeName(project.title)}-storyboard.zip`, entries);
  }
}
