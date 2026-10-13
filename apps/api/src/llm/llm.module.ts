import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { LLM_TRANSPORT, LlmService } from './llm.service';
import { CopyGuardService } from './copy-guard.service';
import { VersionPickService } from './version-pick.service';
import { JevService } from './jev.service';
import { PromptService } from './prompt.service';
import { FixtureTransport, LiveTransport, type LlmTransport } from './transport';

export function createTransport(config: AppConfig): LlmTransport {
  switch (config.llmMode) {
    case 'live':
      return new LiveTransport(config.anthropicApiKey);
    case 'record':
      return new FixtureTransport('record', config.fixturesDir, new LiveTransport(config.anthropicApiKey));
    case 'mock':
    case 'replay':
      return new FixtureTransport(config.llmMode, config.fixturesDir);
  }
}

@Global()
@Module({
  providers: [
    { provide: LLM_TRANSPORT, inject: [APP_CONFIG], useFactory: createTransport },
    { provide: PromptService, useFactory: () => new PromptService() },
    LlmService,
    JevService,
    CopyGuardService,
    VersionPickService,
  ],
  exports: [LlmService, PromptService, JevService, CopyGuardService, VersionPickService],
})
export class LlmModule {}
