import { Module } from '@nestjs/common';
import { uploadsModule } from '../storage/uploads';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { PersonaService } from './persona.service';

@Module({
  imports: [uploadsModule()],
  controllers: [InfluencersController],
  providers: [InfluencersService, PersonaService],
  exports: [InfluencersService],
})
export class InfluencersModule {}
