import { Module, type DynamicModule } from '@nestjs/common';
import { AssetsModule } from './assets/assets.module';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import type { ToolVersions } from './config/startup-checks';
import { HealthController } from './health/health.controller';
import { InfluencersModule } from './influencers/influencers.module';
import { ProjectsModule } from './projects/projects.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { SourcesModule } from './sources/sources.module';
import { StorageModule } from './storage/storage.module';
import { UsageModule } from './usage/usage.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, tools: ToolVersions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config, tools),
        PrismaModule,
        StorageModule,
        SettingsModule,
        JobsModule,
        LlmModule,
        InfluencersModule,
        ProjectsModule,
        AssetsModule,
        SourcesModule,
        UsageModule,
      ],
      controllers: [HealthController],
    };
  }
}
