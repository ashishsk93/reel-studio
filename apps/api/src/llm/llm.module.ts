import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { LLM_TRANSPORT, LlmService } from './llm.service';
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
  ],
  exports: [LlmService, PromptService],
})
export class LlmModule {}
