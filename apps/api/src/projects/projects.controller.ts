import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  IdOrderSchema,
  ProductImageUpdateSchema,
  ProductUpdateSchema,
  ProjectGotoSchema,
  ProjectUpdateSchema,
} from '@reel/shared';
import { ZodPipe } from '../common/zod';
import { ProjectsService } from './projects.service';

const PostedSchema = z.object({ posted: z.boolean().default(true) });

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  list() {
    return this.projects.list();
  }

  /** Multipart: the project fields, `products` (JSON array, each with `imageCount`), `images` in product order and `roles`. */
  @Post('projects')
  @UseInterceptors(FilesInterceptor('images'))
  create(@UploadedFiles() files: Express.Multer.File[], @Body() fields: Record<string, unknown>) {
    return this.projects.create(files, fields);
  }

  @Get('projects/:id')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Patch('projects/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(ProjectUpdateSchema)) body: z.output<typeof ProjectUpdateSchema>) {
    return this.projects.update(id, body);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.projects.remove(id);
  }

  @Post('projects/:id/goto')
  goto(@Param('id') id: string, @Body(new ZodPipe(ProjectGotoSchema)) body: z.output<typeof ProjectGotoSchema>) {
    return this.projects.goto(id, body.status);
  }

  @Post('projects/:id/posted')
  posted(@Param('id') id: string, @Body(new ZodPipe(PostedSchema)) body: z.output<typeof PostedSchema>) {
    return this.projects.markPosted(id, body.posted);
  }

  /** Multipart: the product fields, its `images` and `roles`. */
  @Post('projects/:id/products')
  @UseInterceptors(FilesInterceptor('images'))
  addProduct(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Body() fields: Record<string, unknown>) {
    return this.projects.addProduct(id, files, fields);
  }

  @Put('projects/:id/products/order')
  reorderProducts(@Param('id') id: string, @Body(new ZodPipe(IdOrderSchema)) body: z.output<typeof IdOrderSchema>) {
    return this.projects.reorderProducts(id, body.ids);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body(new ZodPipe(ProductUpdateSchema)) body: z.output<typeof ProductUpdateSchema>) {
    return this.projects.updateProduct(id, body);
  }

  @Delete('products/:id')
  removeProduct(@Param('id') id: string) {
    return this.projects.removeProduct(id);
  }

  @Post('products/:id/images')
  @UseInterceptors(FilesInterceptor('images'))
  addImages(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Body() fields: Record<string, unknown>) {
    return this.projects.addImages(id, files, fields);
  }

  @Put('products/:id/images/order')
  reorder(@Param('id') id: string, @Body(new ZodPipe(IdOrderSchema)) body: z.output<typeof IdOrderSchema>) {
    return this.projects.reorderImages(id, body.ids);
  }

  @Patch('product-images/:id')
  updateImage(
    @Param('id') id: string,
    @Body(new ZodPipe(ProductImageUpdateSchema)) body: z.output<typeof ProductImageUpdateSchema>,
  ) {
    return this.projects.updateImage(id, body.role);
  }

  @Delete('product-images/:id')
  @HttpCode(204)
  deleteImage(@Param('id') id: string) {
    return this.projects.deleteImage(id);
  }
}
