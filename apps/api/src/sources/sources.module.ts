import { Module } from '@nestjs/common';
import { uploadsModule } from '../storage/uploads';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  imports: [uploadsModule()],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
