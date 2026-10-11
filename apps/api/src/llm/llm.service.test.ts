import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SETTINGS, type SettingKey } from '@reel/shared';
import type { AppConfig } from '../config/env';
import { LlmOutputError, LlmRefusalError, LlmService } from './llm.service';
import { prepareImage } from './image-prep';
import { fingerprintRequest, type LlmTransport, type TransportRequest } from './transport';

const Schema = z.object({ title: z.string(), tags: z.array(z.string()) });

function message(text: string, overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
    ...overrides,
  } as Anthropic.Message;
}

function setup(responses: Anthropic.Message[]) {
  const requests: TransportRequest[] = [];
  const transport: LlmTransport = {
    mode: 'mock',
    send: vi.fn(async (req: TransportRequest) => {
      // Snapshot: the service mutates its messages array between attempts.
      requests.push(structuredClone({ ...req, params: { ...req.params, output_config: undefined } }) as TransportRequest);
      const next = responses.shift();
      if (!next) throw new Error('No scripted response left');
      return next;
    }),
  };
  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    llmCall: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push(data);
        return { id: `call_${calls.length}`, ...data };
      }),
    },
  };
  const settings = { get: async (key: SettingKey) => SETTINGS[key].default };
  const storage = { abs: (p: string) => p };
  const logs = { write: vi.fn() };
  const config = { modelDefault: 'claude-haiku-5-5', modelReview: 'claude-sonnet-5-5' } as AppConfig;
  const service = new LlmService(config, transport, prisma as never, settings as never, storage as never, logs as never);
  return { service, requests, calls, logs };
}

describe('LlmService', () => {
  it('returns validated output, marks the last stable block for caching and logs cost', async () => {
    const { service, requests, calls } = setup([message('{"title":"Lavender set","tags":["festive"]}')]);
    const result = await service.call({
      task: 'product_analysis',
      schema: Schema,
      system: ['system prompt', 'persona block'],
      content: [{ type: 'text', text: 'analyse' }],
      projectId: 'p1',
    });

    expect(result.data).toEqual({ title: 'Lavender set', tags: ['festive'] });
    expect(result.attempts).toBe(1);
    const system = requests[0].params.system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    // Haiku 5.5 default prices: 1000×0.10 + 200×0.50 + 500×0.01 per 1M
    expect(result.costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5 + 500 * 0.01) / 1e6, 12);
    expect(calls[0]).toMatchObject({ task: 'product_analysis', projectId: 'p1', ok: true, attempts: 1, cacheReadTokens: 500 });
  });

  it('uses the review model for reviews', async () => {
    const { service, requests } = setup([message('{"title":"x","tags":[]}')]);
    await service.call({ task: 'image_review', schema: Schema, system: ['s'], content: [], modelKind: 'review' });
    expect(requests[0].params.model).toBe('claude-sonnet-5-5');
  });

  it('sends the validation error back and retries', async () => {
    const { service, requests } = setup([
      message('{"title":"x"}'),
      message('not json'),
      message('{"title":"x","tags":["a"]}'),
    ]);
    const result = await service.call({ task: 'storyboard', schema: Schema, system: ['s'], content: [{ type: 'text', text: 'go' }] });

    expect(result.attempts).toBe(3);
    const second = requests[1].params.messages;
    expect(second).toHaveLength(3);
    expect(JSON.stringify(second[2].content)).toContain('tags');
    expect(JSON.stringify(requests[2].params.messages.at(-1)?.content)).toContain('not valid JSON');
  });

  it('gives up after two retries and logs the failure', async () => {
    const { service, calls } = setup([message('{}'), message('{}'), message('{}')]);
    await expect(
      service.call({ task: 'captions', schema: Schema, system: ['s'], content: [] }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(calls[0]).toMatchObject({ ok: false, attempts: 3, inputTokens: 3000 });
  });

  it('does not retry a refusal', async () => {
    const { service, requests } = setup([message('', { stop_reason: 'refusal' })]);
    await expect(service.call({ task: 'captions', schema: Schema, system: ['s'], content: [] })).rejects.toBeInstanceOf(
      LlmRefusalError,
    );
    expect(requests).toHaveLength(1);
  });

  it('treats a max_tokens cut-off as invalid output', async () => {
    const { service } = setup([message('{"title":"x","ta', { stop_reason: 'max_tokens' }), message('{"title":"x","tags":[]}')]);
    const result = await service.call({ task: 'captions', schema: Schema, system: ['s'], content: [] });
    expect(result.attempts).toBe(2);
  });
});

describe('images', () => {
  let big: string;
  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-llm-'));
    big = path.join(dir, 'big.png');
    await sharp({ create: { width: 4000, height: 2000, channels: 4, background: { r: 200, g: 100, b: 150, alpha: 0.5 } } })
      .png()
      .toFile(big);
  });

  it('downscales to a 1568 px long edge and re-encodes as JPEG', async () => {
    const image = await prepareImage(big);
    expect(image.mediaType).toBe('image/jpeg');
    expect(Math.max(image.width, image.height)).toBe(1568);
    expect(image.height).toBe(784);
    const meta = await sharp(Buffer.from(image.base64, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('sends a label before each image and keeps image bytes out of the log', async () => {
    const { service, requests, logs } = setup([message('{"title":"x","tags":[]}')]);
    await service.call({
      task: 'image_review',
      schema: Schema,
      system: ['s'],
      content: [{ type: 'image', path: big, label: 'Image 1: anchor' }],
    });
    const blocks = requests[0].params.messages[0].content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).toEqual({ type: 'text', text: 'Image 1: anchor' });
    expect(blocks[1].type).toBe('image');
    const logged = JSON.stringify(logs.write.mock.calls[0][2]);
    expect(logged).toContain(big.replaceAll('\\', '\\\\'));
    expect(logged.length).toBeLessThan(5000);
  });

  it('fingerprints requests by image digest, not bytes', () => {
    const params = (data: string) =>
      ({
        model: 'm',
        max_tokens: 1,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }] }],
      }) as Anthropic.MessageCreateParamsNonStreaming;
    const a = fingerprintRequest(params('A'.repeat(1000)));
    expect(a).toBe(fingerprintRequest(params('A'.repeat(1000))));
    expect(a).not.toBe(fingerprintRequest(params('B'.repeat(1000))));
  });
});
