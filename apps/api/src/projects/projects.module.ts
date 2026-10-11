import { Module } from '@nestjs/common';
import { ProductController } from '../product/product.controller';
import { ProductService } from '../product/product.service';
import { StoryboardController } from '../storyboard/storyboard.controller';
import { StoryboardService } from '../storyboard/storyboard.service';
import { uploadsModule } from '../storage/uploads';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [uploadsModule()],
  controllers: [ProjectsController, ProductController, StoryboardController],
  providers: [ProjectsService, ProductService, StoryboardService],
  exports: [ProjectsService, ProductService, StoryboardService],
})
export class ProjectsModule {}
