import { Module } from '@nestjs/common';
import { CreatorController } from '../creator/creator.controller';
import { CreatorService } from '../creator/creator.service';
import { InfluencersModule } from '../influencers/influencers.module';
import { ProjectsModule } from '../projects/projects.module';
import { uploadsModule } from '../storage/uploads';
import { AssetContextService } from './asset-context.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssistantService } from './assistant.service';
import { ReviewService } from './review.service';

/** Step 4 (generated images, reviews, modification assistant) and the character creator's reference plan. */
@Module({
  imports: [uploadsModule(), ProjectsModule, InfluencersModule],
  controllers: [AssetsController, CreatorController],
  providers: [AssetContextService, ReviewService, AssetsService, AssistantService, CreatorService],
  exports: [AssetsService],
})
export class AssetsModule {}
