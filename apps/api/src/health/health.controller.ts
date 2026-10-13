import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthDto } from '@reel/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { TOOL_VERSIONS } from '../config/config.module';
import type { ToolVersions } from '../config/startup-checks';
import { DecisionService } from '../llm/decision.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TOOL_VERSIONS) private readonly tools: ToolVersions,
    private readonly decisions: DecisionService,
  ) {}

  @Get()
  health(): HealthDto {
    return {
      ok: true,
      llmMode: this.config.llmMode,
      hasApiKey: Boolean(this.config.anthropicApiKey),
      decisions: this.decisions.enabled,
      decisionsBlocked: this.decisions.blockedReason,
      ffmpeg: this.tools.ffmpeg,
      ffprobe: this.tools.ffprobe,
      dataDir: this.config.dataDir,
      modelDefault: this.config.modelDefault,
      modelReview: this.config.modelReview,
    };
  }
}
