import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/env';
import { CopyGuardService } from './copy-guard.service';
import { JevService, type JevAnswer } from './jev.service';
import { rulesPick } from './version-pick.service';

const config = { jevApiKey: 'test-key', jevModel: 'jev-latest', jevApiUrl: 'https://jev.test', llmMode: 'live' } as AppConfig;

function fakes() {
  const calls: Array<Record<string, unknown>> = [];
  const prisma = { llmCall: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (calls.push(data), { id: 'c1', ...data })) } };
  const logs = { write: vi.fn() };
  return { calls, prisma, logs };
}

const ok = (answers: Record<string, JevAnswer>, inputTokens = 1000) =>
  new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: inputTokens, output_tokens: 0 } }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('JevService', () => {
  it('sends the state and questions with the key, retries when busy, and logs the cost', async () => {
    const { calls, prisma, logs } = fakes();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 529 }))
      .mockResolvedValueOnce(ok({ q: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.85 } }));
    vi.stubGlobal('fetch', fetchMock);
    const jev = new JevService(config, prisma as never, logs as never);
    const answers = await jev.ask({ task: 'copy_guard', state: 's', questions: { q: { type: 'choice', instructions: 'i', criteria: { a: null, b: null } } } });
    expect(answers?.q).toMatchObject({ choice: 'a' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://jev.test/v1/systemone');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'jev-latest', state: 's' });
    expect(calls[0]).toMatchObject({ task: 'copy_guard', model: 'jev-1.13.0', inputTokens: 1000, ok: true, attempts: 2 });
    expect(calls[0].costUsd).toBeCloseTo(0.000042, 9);
  }, 10_000);

  it('is off without a key or in mock mode, and returns null on errors', async () => {
    const { prisma, logs } = fakes();
    expect(new JevService({ ...config, jevApiKey: '' }, prisma as never, logs as never).enabled).toBe(false);
    expect(new JevService({ ...config, llmMode: 'mock' }, prisma as never, logs as never).enabled).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
    const jev = new JevService(config, prisma as never, logs as never);
    expect(await jev.ask({ task: 'copy_guard', state: 's', questions: { q: { type: 'choice', instructions: 'i', criteria: { a: null } } } })).toBeNull();
  });
});

describe('CopyGuardService', () => {
  it('flags lines Jev reads as claims, above the confidence threshold', async () => {
    const jev = {
      enabled: true,
      ask: vi.fn(async () => ({
        q0: { type: 'choice', choice: 'ok', probabilities: {}, confidence: 0.9 },
        q1: { type: 'choice', choice: 'feel', probabilities: {}, confidence: 0.8 },
        q2: { type: 'choice', choice: 'fit', probabilities: {}, confidence: 0.3 },
      })),
    };
    const guard = new CopyGuardService(jev as never);
    const flags = await guard.check([
      { key: 'a', text: 'Teal kurta with gold zari' },
      { key: 'b', text: 'Melts on the skin' },
      { key: 'c', text: 'Maybe runs a little big' },
      { key: 'd', text: '' },
    ]);
    expect(flags).toEqual([expect.objectContaining({ key: 'b', flag: 'feel', message: '"Melts on the skin" claims how the fabric feels or how comfortable it is' })]);
  });

  it('does nothing when Jev is off', async () => {
    const guard = new CopyGuardService({ enabled: false, ask: vi.fn() } as never);
    expect(await guard.check([{ key: 'a', text: 'So comfy' }])).toEqual([]);
  });
});

describe('rulesPick', () => {
  it('prefers the best verdict, then the least severe issues, then the newest', () => {
    const v = (version: number, verdict: string, severities: string[]) => ({
      assetId: `a${version}`,
      version,
      verdict,
      issues: severities.map((severity) => ({ severity })),
    });
    expect(rulesPick([v(1, 'pass', ['minor']), v(2, 'warn', [])]).version).toBe(1);
    expect(rulesPick([v(1, 'warn', ['major']), v(2, 'warn', ['minor', 'minor'])]).version).toBe(2);
    expect(rulesPick([v(1, 'pass', []), v(2, 'pass', [])]).version).toBe(2);
  });
});
