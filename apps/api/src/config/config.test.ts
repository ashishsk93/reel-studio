import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';
import { StartupError, runStartupChecks } from './startup-checks';
import { parsePromptFile, renderTemplate } from '../llm/prompt.service';

describe('loadConfig', () => {
  const root = path.resolve('/repo');

  it('applies defaults and treats blank values as unset', () => {
    const config = loadConfig({ repoRoot: root, env: { ANTHROPIC_API_KEY: '', PORT_API: '' } });
    expect(config.modelDefault).toBe('claude-haiku-5-5');
    expect(config.llmMode).toBe('live');
    expect(config.portApi).toBe(4000);
    expect(config.dataDir).toBe(path.join(root, 'data'));
    expect(config.databaseUrl).toBe(`file:${path.join(root, 'data', 'app.db')}`);
  });

  it('serves files from PUBLIC_URL and binds to HOST on a server', () => {
    const local = loadConfig({ repoRoot: root, env: {} });
    expect(local.apiOrigin).toBe('http://localhost:4000');
    expect(local.host).toBeUndefined();
    const server = loadConfig({ repoRoot: root, env: { PUBLIC_URL: 'https://studio.velra.tech/', HOST: '127.0.0.1', PORT_API: '4100' } });
    expect(server.apiOrigin).toBe('https://studio.velra.tech');
    expect(server.webOrigin).toBe('https://studio.velra.tech');
    expect(server.host).toBe('127.0.0.1');
    expect(server.portApi).toBe(4100);
  });

  it('rejects an unknown LLM mode', () => {
    expect(() => loadConfig({ repoRoot: root, env: { LLM_MODE: 'turbo' } })).toThrow(/LLM_MODE/);
  });
});

describe('runStartupChecks', () => {
  it('lists every problem at once', async () => {
    const config = loadConfig({
      repoRoot: path.resolve('/repo'),
      env: { FFMPEG_PATH: 'definitely-not-ffmpeg', FFPROBE_PATH: 'definitely-not-ffprobe' },
    });
    const error = await runStartupChecks(config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).problems).toHaveLength(3);
    expect((error as StartupError).message).toContain('ANTHROPIC_API_KEY');
  });

  it('does not need a key in mock mode', async () => {
    const config = loadConfig({ repoRoot: path.resolve('/repo'), env: { LLM_MODE: 'mock' } });
    const versions = await runStartupChecks(config);
    expect(versions.ffmpeg).toMatch(/^ffmpeg version/);
  });
});

describe('prompt files', () => {
  it('parses front-matter and renders variables', () => {
    const file = parsePromptFile('x', '---\nversion: 3\ndescription: test\n---\nHello {{name}}!');
    expect(file).toMatchObject({ version: 3, description: 'test', body: 'Hello {{name}}!' });
    expect(renderTemplate(file.body, { name: 'Aanya' })).toBe('Hello Aanya!');
    expect(() => renderTemplate(file.body, {})).toThrow(/name/);
  });
});
