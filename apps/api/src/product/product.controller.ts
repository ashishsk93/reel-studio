import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { InstructionSchema, ProductSpecSaveSchema } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { ProductService } from './product.service';

@Controller('projects/:id')
export class ProductController {
  constructor(private readonly product: ProductService) {}

  @Post('analyze')
  analyze(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.product.startAnalysis(id, body.instruction);
  }

  /** null until the first analysis finishes. */
  @Get('spec')
  async spec(@Param('id') id: string) {
    return { spec: await this.product.get(id) };
  }

  @Put('spec')
  save(@Param('id') id: string, @Body(new ZodPipe(ProductSpecSaveSchema)) body: z.output<typeof ProductSpecSaveSchema>) {
    return this.product.save(id, body);
  }

  @Post('spec/paragraph')
  paragraph(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.product.startParagraph(id, body.instruction);
  }
}
