import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { InstructionSchema, ProductSpecSaveSchema } from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { ProductService } from './product.service';

const AnalyzeAllSchema = z.object({ all: z.boolean().default(false) });

@Controller()
export class ProductController {
  constructor(private readonly product: ProductService) {}

  /** Analyses the products without an analysis (or all of them with `all: true`). */
  @Post('projects/:id/analyze')
  analyzeProject(@Param('id') id: string, @Body(new ZodPipe(AnalyzeAllSchema)) body: z.output<typeof AnalyzeAllSchema>) {
    return this.product.startProjectAnalysis(id, body.all);
  }

  /** Every product's analysis, in no particular order (match by productId). */
  @Get('projects/:id/specs')
  async specs(@Param('id') id: string) {
    return { specs: [...(await this.product.specs(id)).values()] };
  }

  @Post('products/:id/analyze')
  analyze(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.product.startAnalysis(id, body.instruction);
  }

  /** null until the first analysis finishes. */
  @Get('products/:id/spec')
  async spec(@Param('id') id: string) {
    return { spec: await this.product.forProduct(id) };
  }

  @Put('products/:id/spec')
  save(@Param('id') id: string, @Body(new ZodPipe(ProductSpecSaveSchema)) body: z.output<typeof ProductSpecSaveSchema>) {
    return this.product.save(id, body);
  }

  @Post('products/:id/spec/paragraph')
  paragraph(@Param('id') id: string, @Body(new ZodPipe(InstructionSchema)) body: z.output<typeof InstructionSchema>) {
    return this.product.startParagraph(id, body.instruction);
  }
}
