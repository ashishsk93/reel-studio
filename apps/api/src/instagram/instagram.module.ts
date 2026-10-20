import { Module } from '@nestjs/common';
import { AutoReplyService } from './auto-reply.service';
import { InstagramController } from './instagram.controller';
import { InstagramService } from './instagram.service';
import { PublishService } from './publish.service';

/** Your own Instagram account: publish Reels and answer keyword comments and DMs. */
@Module({
  controllers: [InstagramController],
  providers: [InstagramService, AutoReplyService, PublishService],
})
export class InstagramModule {}
