/**
 * Live smoke test: one cheap call per configured model with an image and structured output.
 * Verifies the key, the model ids, JSON-schema output and vision. Never prints the key.
 *   pnpm --filter @reel/api llm:check
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import sharp from 'sharp';
import { z } from 'zod';
import { loadConfig } from '../src/config/env';

const Answer = z.object({
  dominantColour: z.string().describe('The single dominant colour name'),
  shape: z.string(),
  confidence: z.number(),
});

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is empty in .env');
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><circle cx="200" cy="200" r="150" fill="#d10a8f"/></svg>',
  );
  const image = (await sharp(svg).jpeg({ quality: 85 }).toBuffer()).toString('base64');

  for (const model of [...new Set([config.modelDefault, config.modelReview])]) {
    const started = Date.now();
    const message = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(Answer), effort: 'low' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: 'Describe the shape in this image.' },
          ],
        },
      ],
    });
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = Answer.safeParse(JSON.parse(text));
    console.log(
      JSON.stringify({
        model,
        stopReason: message.stop_reason,
        validJson: parsed.success,
        answer: parsed.success ? parsed.data : text.slice(0, 200),
        usage: { in: message.usage.input_tokens, out: message.usage.output_tokens },
        ms: Date.now() - started,
      }),
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError) console.error('Authentication failed: check ANTHROPIC_API_KEY.');
  else if (error instanceof Anthropic.NotFoundError) console.error(`Model not found: ${error.message}`);
  else if (error instanceof Anthropic.APIError) console.error(`API error ${error.status}: ${error.message}`);
  else console.error(error);
  process.exit(1);
});
