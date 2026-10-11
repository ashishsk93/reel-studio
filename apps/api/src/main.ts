import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { loadConfig } from './config/env';
import { StartupError, runStartupChecks } from './config/startup-checks';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig();
  const tools = await runStartupChecks(config);

  const app = await NestFactory.create(AppModule.forRoot(config, tools), { bufferLogs: false });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: [config.webOrigin, `http://127.0.0.1:${config.portWeb}`] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.portApi);
  logger.log(`API on ${config.apiOrigin}/api · LLM_MODE=${config.llmMode} · models ${config.modelDefault} / ${config.modelReview}`);
  logger.log(`DATA_DIR ${config.dataDir} · ${tools.ffmpeg}`);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof StartupError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
