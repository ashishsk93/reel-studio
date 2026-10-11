import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './env';
import type { ToolVersions } from './startup-checks';

export const TOOL_VERSIONS = Symbol('TOOL_VERSIONS');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig, tools: ToolVersions): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: TOOL_VERSIONS, useValue: tools },
      ],
      exports: [APP_CONFIG, TOOL_VERSIONS],
    };
  }
}
