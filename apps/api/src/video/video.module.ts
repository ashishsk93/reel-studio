import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { MAX_VIDEO_BYTES, uploadsModule } from '../storage/uploads';
import { MediaService } from './media.service';
import { VideoAssetsService } from './video-assets.service';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

/** Steps 5–6: Kling prompts, video uploads, cut detection, video review, timeline windows and segments. */
@Module({
  imports: [uploadsModule({ maxBytes: MAX_VIDEO_BYTES, files: 1 }), ProjectsModule],
  controllers: [VideoController],
  providers: [MediaService, VideoService, VideoAssetsService],
  exports: [VideoService, VideoAssetsService, MediaService],
})
export class VideoModule {}
