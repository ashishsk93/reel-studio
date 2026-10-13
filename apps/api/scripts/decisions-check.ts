/**
 * Live check of the OpenAI Decisions API with real project images (copy guardrail, version pick,
 * cover frame). Read-only: nothing in the database changes. Usage:
 *   pnpm --filter @reel/api exec tsx scripts/decisions-check.ts <input.json>
 * where input.json holds { scene, versions: [{ version, path, verdict, issues }], anchor, product, frames }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/env';
import { CopyGuardService } from '../src/llm/copy-guard.service';
import { DecisionService, type ChoiceAnswer, type DecisionPart } from '../src/llm/decision.service';

interface Input {
  scene: { order: number; type: string; purpose: string; description: string };
  versions: Array<{ version: number; path: string; verdict: string; issues: Array<{ severity: string; description: string }> }>;
  anchor: string;
  product: string;
  frames: string[];
}

async function main(): Promise<void> {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as Input;
  const config = loadConfig();
  const costs: Array<{ task: string; inputTokens: number; costUsd: number; latencyMs: number; ok: boolean; error: string | null }> = [];
  const prisma = { llmCall: { create: async ({ data }: { data: (typeof costs)[number] }) => (costs.push(data), { id: 'x', ...data }) } };
  const storage = { abs: (rel: string) => path.join(config.dataDir, rel) };
  const decisions = new DecisionService(config, prisma as never, { write: () => undefined } as never, storage as never);
  if (!decisions.enabled) throw new Error('Decisions are off: set OPENAI_API_KEY in .env (and LLM_MODE=live).');

  // 1. Copy guardrail: clean lines and paraphrased claims the word list would miss.
  const lines = [
    'Pale teal kurta with gold zari 💙',
    'Melts on your skin like butter',
    'Runs a little big, size down',
    'Only a handful left, grab yours',
    'Kurta + pants + dupatta',
    'Lands at your door by Friday',
  ];
  const flags = await new CopyGuardService(decisions).check(lines.map((text, i) => ({ key: String(i), text })));
  console.log('\n1. Copy guardrail');
  for (const [i, text] of lines.entries()) {
    const f = flags.find((x) => x.key === String(i));
    console.log(`   ${f ? `FLAG ${f.flag.padEnd(8)}` : 'ok           '} ${text}`);
  }

  // 2. Version pick: both versions next to her anchor and the product photo.
  const parts: DecisionPart[] = [
    { type: 'text', text: `Generated images for one scene of an Instagram fashion affiliate Reel. Scene ${input.scene.order + 1} (${input.scene.type}): ${input.scene.purpose} ${input.scene.description}` },
    { type: 'image', path: input.anchor, label: 'Reference: her face (anchor)' },
    { type: 'image', path: input.product, label: 'Reference: the product' },
    ...input.versions.map(
      (v): DecisionPart => ({
        type: 'image',
        path: v.path,
        label: `Version ${v.version} (review: ${v.verdict}; ${v.issues.map((i) => `${i.severity}: ${i.description}`).join('; ') || 'no issues'})`,
      }),
    ),
  ];
  const pick = await decisions.ask({
    task: 'version_pick',
    input: parts,
    questions: [
      {
        type: 'choice',
        name: 'best',
        instructions:
          'Which version should be approved for the Reel? She must look like the face reference and the garment must match the product exactly; then prefer fewer and milder problems (hands, artefacts, drift), then the better composition. Prefer a newer version only when the others are equally good.',
        choices: input.versions.map((v) => ({ value: `v${v.version}`, description: `Version ${v.version}` })),
      },
    ],
  });
  const best = pick?.get('best') as ChoiceAnswer | undefined;
  console.log('\n2. Version pick', best ? `→ ${best.choice} (confidence ${best.confidence.toFixed(2)}; ${best.probabilities.map((p) => `${p.value} ${p.probability.toFixed(2)}`).join(', ')})` : '→ no answer');
  console.log(`   reviews: ${input.versions.map((v) => `v${v.version} ${v.verdict} (${v.issues.length} issues)`).join(', ')}`);

  // 3. Cover frame: one frame from each segment's clip.
  const cover = await decisions.ask({
    task: 'cover_pick',
    input: [
      { type: 'text', text: 'Candidate cover frames for an Instagram fashion Reel. The cover shows in the profile grid, cropped to 3:4 around the centre.' },
      ...input.frames.map((p, i): DecisionPart => ({ type: 'image', path: p, label: `Candidate ${i + 1}` })),
    ],
    questions: [
      {
        type: 'choice',
        name: 'cover',
        instructions:
          'Which frame makes the best cover? Her face clear and in focus with eyes open and a natural expression, the outfit clearly visible, sharp with no motion blur or artefacts, and a flattering, centred composition.',
        choices: input.frames.map((_, i) => ({ value: String(i + 1), description: `Candidate ${i + 1}` })),
      },
    ],
  });
  const c = cover?.get('cover') as ChoiceAnswer | undefined;
  console.log('\n3. Cover frame', c ? `→ candidate ${c.choice} of ${input.frames.length} (confidence ${c.confidence.toFixed(2)})` : '→ no answer');

  console.log('\nCalls');
  for (const x of costs) console.log(`   ${x.task.padEnd(12)} ${String(x.inputTokens).padStart(6)} tokens  $${x.costUsd.toFixed(6)}  ${x.latencyMs} ms  ${x.ok ? 'ok' : `FAILED ${x.error}`}`);
  console.log(`   total $${costs.reduce((n, x) => n + x.costUsd, 0).toFixed(6)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
