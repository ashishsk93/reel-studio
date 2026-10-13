import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/env';
import { CopyGuardService } from './copy-guard.service';
import { DecisionService, type DecisionAnswer } from './decision.service';
import { rulesPick, spreadFrames } from './version-pick.service';

const config = { openaiApiKey: 'test-key', decisionModel: 'gpt-6-luna', openaiApiUrl: 'https://openai.test', llmMode: 'live' } as AppConfig;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
  await sharp({ create: { width: 64, height: 96, channels: 3, background: '#cc3366' } }).png().toFile(path.join(dir, 'frame.png'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

function service(over: Partial<AppConfig> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const prisma = { llmCall: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (calls.push(data), { id: 'c1', ...data })) } };
  const storage = { abs: (rel: string) => path.join(dir, rel) };
  const decisions = new DecisionService({ ...config, ...over }, prisma as never, { write: vi.fn() } as never, storage as never);
  return { decisions, calls };
}

const ok = (answers: DecisionAnswer[], inputTokens = 2000) =>
  new Response(JSON.stringify({ model: 'gpt-6-luna-2026-10-01', answers, usage: { input_tokens: inputTokens, output_tokens: 0 } }), { status: 200 });

describe('DecisionService', () => {
  it('sends text and inline images as a user message, retries when busy, and logs the cost', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(ok([{ type: 'predicate', name: 'face', probability: 0.12 }]));
    vi.stubGlobal('fetch', fetchMock);
    const { decisions, calls } = service();
    const answers = await decisions.ask({
      task: 'placement_check',
      input: [{ type: 'text', text: 'One frame' }, { type: 'image', path: 'frame.png', label: 'Frame:' }],
      questions: [{ type: 'predicate', name: 'face', instructions: 'Covers her face?' }],
    });
    expect(answers?.get('face')).toEqual({ type: 'predicate', name: 'face', probability: 0.12 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://openai.test/v1/decisions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input[0].role).toBe('user');
    expect(body.input[0].content.map((c: { type: string }) => c.type)).toEqual(['input_text', 'input_text', 'input_image']);
    expect(body.input[0].content[2].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.questions).toEqual([{ type: 'predicate', name: 'face', instructions: 'Covers her face?' }]);
    expect(calls[0]).toMatchObject({ task: 'placement_check', model: 'gpt-6-luna-2026-10-01', inputTokens: 2000, ok: true, attempts: 2 });
    expect(calls[0].costUsd).toBeCloseTo(0.0002, 9);
  }, 10_000);

  it('is off without a key or in mock mode, and returns null (logged) on errors', async () => {
    expect(service({ openaiApiKey: '' }).decisions.enabled).toBe(false);
    expect(service({ llmMode: 'mock' }).decisions.enabled).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
    const { decisions, calls } = service();
    expect(await decisions.ask({ task: 'copy_guard', input: 'x', questions: [{ type: 'predicate', name: 'q', instructions: 'i' }] })).toBeNull();
    expect(calls[0]).toMatchObject({ ok: false, error: expect.stringContaining('401') });
  });
});

describe('CopyGuardService', () => {
  const choice = (name: string, value: string, okProbability: number): DecisionAnswer => ({
    type: 'choice',
    name,
    choice: value,
    probabilities: [
      { value: 'ok', probability: okProbability },
      { value, probability: 1 - okProbability },
    ],
    confidence: 0.9,
  });

  it('flags lines read as claims unless "ok" is still likely', async () => {
    const decisions = {
      enabled: true,
      ask: vi.fn(async () => new Map([['line0', choice('line0', 'ok', 0.95)], ['line1', choice('line1', 'feel', 0.05)], ['line2', choice('line2', 'fit', 0.45)]])),
    };
    const flags = await new CopyGuardService(decisions as never).check([
      { key: 'a', text: 'Teal kurta with gold zari' },
      { key: 'b', text: 'Melts on the skin' },
      { key: 'c', text: 'Maybe runs a little big' },
      { key: 'd', text: '' },
    ]);
    expect(flags).toEqual([expect.objectContaining({ key: 'b', flag: 'feel', message: '"Melts on the skin" claims how the fabric feels or how comfortable it is' })]);
  });

  it('does nothing when decisions are off', async () => {
    expect(await new CopyGuardService({ enabled: false, ask: vi.fn() } as never).check([{ key: 'a', text: 'So comfy' }])).toEqual([]);
  });
});

describe('version pick helpers', () => {
  it('rules: best verdict, then the least severe issues, then the newest', () => {
    const v = (version: number, verdict: string, severities: string[]) => ({ assetId: `a${version}`, version, verdict, issues: severities.map((severity) => ({ severity })) });
    expect(rulesPick([v(1, 'pass', ['minor']), v(2, 'warn', [])]).version).toBe(1);
    expect(rulesPick([v(1, 'warn', ['major']), v(2, 'warn', ['minor', 'minor'])]).version).toBe(2);
    expect(rulesPick([v(1, 'pass', []), v(2, 'pass', [])]).version).toBe(2);
  });

  it('spreads video frames evenly, first and last included', () => {
    expect(spreadFrames([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6]);
    expect(spreadFrames([0, 1], 3)).toEqual([0, 1]);
  });
});
