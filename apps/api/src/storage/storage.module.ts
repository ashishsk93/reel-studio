import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LogService } from './log.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [StorageService, LogService],
  exports: [StorageService, LogService],
})
export class StorageModule {}
