import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { uploadsModule } from '../storage/uploads';
import { VideoModule } from '../video/video.module';
import { ComposeController } from './compose.controller';
import { ComposeService } from './compose.service';
import { CoverCaptionsService } from './cover-captions.service';

/** Step 7: overlays, badge placement, CTA, music, cover and captions. */
@Module({
  imports: [uploadsModule({ maxBytes: 200 * 1024 * 1024, files: 1 }), ProjectsModule, VideoModule],
  controllers: [ComposeController],
  providers: [ComposeService, CoverCaptionsService],
  exports: [ComposeService, CoverCaptionsService],
})
export class ComposeModule {}
