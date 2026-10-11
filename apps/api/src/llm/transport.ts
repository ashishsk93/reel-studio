import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmMode, LlmTask } from '@reel/shared';

export interface TransportRequest {
  task: LlmTask;
  params: Anthropic.MessageCreateParamsNonStreaming;
  /** Stable hash of the request with image bytes replaced by their digests. */
  fingerprint: string;
}

export interface LlmTransport {
  readonly mode: LlmMode;
  send(request: TransportRequest): Promise<Anthropic.Message>;
}

export class LiveTransport implements LlmTransport {
  readonly mode: LlmMode = 'live';
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
  }

  send({ params }: TransportRequest): Promise<Anthropic.Message> {
    return this.client.messages.create(params);
  }
}

interface FixtureFile {
  /** The structured output the model should "return". */
  output: unknown;
  usage?: Partial<Anthropic.Usage>;
}

/**
 * mock: returns `<task>.json` from the fixtures dir.
 * replay: returns `recorded/<task>-<fingerprint>.json`, falling back to `<task>.json`.
 * record: calls the live API and saves the answer under recorded/.
 */
export class FixtureTransport implements LlmTransport {
  constructor(
    readonly mode: LlmMode,
    private readonly fixturesDir: string,
    private readonly live?: LlmTransport,
  ) {}

  async send(request: TransportRequest): Promise<Anthropic.Message> {
    if (this.mode === 'record') {
      if (!this.live) throw new Error('Record mode needs a live transport');
      const message = await this.live.send(request);
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let output: unknown = text;
      try {
        output = JSON.parse(text);
      } catch {
        // keep raw text so the failure replays too
      }
      const file = this.recordedPath(request);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ output, usage: message.usage }, null, 2));
      return message;
    }

    const candidates =
      this.mode === 'replay'
        ? [this.recordedPath(request), path.join(this.fixturesDir, `${request.task}.json`)]
        : [path.join(this.fixturesDir, `${request.task}.json`)];
    for (const file of candidates) {
      const fixture = await readFixture(file);
      if (fixture) return fixtureMessage(request, fixture);
    }
    throw new Error(
      `LLM_MODE=${this.mode}: no fixture for task "${request.task}" (looked in ${candidates.join(', ')}). ` +
        'Add one or set LLM_MODE=live with an API key.',
    );
  }

  private recordedPath(request: TransportRequest): string {
    return path.join(this.fixturesDir, 'recorded', `${request.task}-${request.fingerprint.slice(0, 16)}.json`);
  }
}

async function readFixture(file: string): Promise<FixtureFile | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as FixtureFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Fixture ${file} is not valid JSON: ${String(error)}`);
  }
}

function fixtureMessage(request: TransportRequest, fixture: FixtureFile): Anthropic.Message {
  const text = typeof fixture.output === 'string' ? fixture.output : JSON.stringify(fixture.output);
  return {
    id: `msg_fixture_${request.fingerprint.slice(0, 12)}`,
    type: 'message',
    role: 'assistant',
    model: request.params.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...fixture.usage,
    },
  } as Anthropic.Message;
}

/** Hashes a request, swapping base64 image data for a digest so fingerprints stay small and stable. */
export function fingerprintRequest(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const json = JSON.stringify(params, (key, value: unknown) => {
    if (key === 'data' && typeof value === 'string' && value.length > 256) {
      return `sha256:${createHash('sha256').update(value).digest('hex')}`;
    }
    if (key === 'output_config' && value && typeof value === 'object') {
      // the format object carries a parse() function; only the schema matters
      const { format, ...rest } = value as { format?: { schema?: unknown } };
      return { ...rest, schema: format?.schema };
    }
    return value;
  });
  return createHash('sha256').update(json).digest('hex');
}
