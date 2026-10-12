import { Module } from '@nestjs/common';
import { ComposeModule } from '../compose/compose.module';
import { ProjectsModule } from '../projects/projects.module';
import { VideoModule } from '../video/video.module';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';

/** Step 8: final render, QA and export. */
@Module({
  imports: [ProjectsModule, VideoModule, ComposeModule],
  controllers: [RenderController],
  providers: [RenderService],
})
export class RenderModule {}
