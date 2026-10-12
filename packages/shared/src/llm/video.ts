import { z } from 'zod';
import { ISSUE_SEVERITIES, VERDICTS, VIDEO_FIX_KINDS } from '../enums.js';
import { hasPlaceholder } from './product.js';

export const ShotIssueSchema = z.object({
  severity: z.enum(ISSUE_SEVERITIES),
  description: z.string(),
  fromSec: z.number().nullable().describe('Video time where it starts, or null if throughout'),
  toSec: z.number().nullable(),
});

export const ShotReviewSchema = z.object({
  shot: z.number().int().describe('Shot number as labelled (1-based)'),
  verdict: z.enum(VERDICTS),
  matchesScene: z.boolean().describe('Does the shot show what its scene asks for?'),
  notes: z.string().describe('One or two sentences: identity, garment, motion, anatomy'),
  issues: z.array(ShotIssueSchema),
  usableFrom: z.number().nullable().describe('Earliest video time (s) that is clean; null = from the start of the shot'),
  usableTo: z.number().nullable().describe('Latest video time (s) before drift or artefacts start; null = to the end of the shot'),
  bestFrom: z
    .number()
    .nullable()
    .describe("Video time (s) where the best window of the shot's target length starts, inside the usable part; null = start of the usable part"),
});
export type ShotReview = z.infer<typeof ShotReviewSchema>;

export const VideoFixSchema = z.object({
  shot: z.number().int().nullable().describe('Shot number, or null for the whole video'),
  kind: z.enum(VIDEO_FIX_KINDS).describe('regenerate_shot = generate this shot alone as a single-scene video; adjust_prompt = change the prompt and regenerate the run'),
  title: z.string(),
  instruction: z.string().describe('What to change and why, for the user'),
  motion: z
    .string()
    .nullable()
    .describe('regenerate_shot only: a new low-motion line for the single-scene prompt, or null to keep the scene motion'),
});
export type VideoFix = z.infer<typeof VideoFixSchema>;

export const VideoReviewOutputSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string(),
  shots: z.array(ShotReviewSchema).describe('One entry per expected shot, in order'),
  fixes: z.array(VideoFixSchema).describe('For warn or fail, most important first; empty for pass'),
});
export type VideoReviewOutput = z.infer<typeof VideoReviewOutputSchema>;

/** Consistency checks for a video review of `shotCount` shots over `durationSec`. */
export function videoReviewChecked(c: { shotCount: number; durationSec: number }) {
  return VideoReviewOutputSchema.superRefine((out, ctx) => {
    const numbers = out.shots.map((s) => s.shot);
    const expected = Array.from({ length: c.shotCount }, (_, i) => i + 1);
    if (numbers.join(',') !== expected.join(',')) {
      ctx.addIssue({ code: 'custom', path: ['shots'], message: `Review shots ${expected.join(', ')} in order, one entry each` });
    }
    const inRange = (t: number | null) => t === null || (t >= -0.01 && t <= c.durationSec + 0.01);
    out.shots.forEach((s, i) => {
      if (!inRange(s.usableFrom) || !inRange(s.usableTo)) {
        ctx.addIssue({ code: 'custom', path: ['shots', i], message: `usableFrom/usableTo must be within 0-${c.durationSec}s` });
      }
      if (s.usableFrom !== null && s.usableTo !== null && s.usableFrom >= s.usableTo) {
        ctx.addIssue({ code: 'custom', path: ['shots', i], message: 'usableFrom must be before usableTo' });
      }
      if (!inRange(s.bestFrom)) ctx.addIssue({ code: 'custom', path: ['shots', i], message: `bestFrom must be within 0-${c.durationSec}s` });
    });
    const serious = out.shots.some((s) => s.verdict === 'fail' || s.issues.some((x) => x.severity !== 'minor'));
    if (out.verdict === 'pass' && serious) {
      ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'A failed shot or a major/critical issue cannot be a pass' });
    }
    if (out.verdict !== 'fail' && out.shots.some((s) => s.issues.some((x) => x.severity === 'critical'))) {
      ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'A critical issue means fail' });
    }
    if (out.verdict !== 'pass' && out.fixes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['fixes'], message: 'Give at least one fix for warn or fail' });
    }
    out.fixes.forEach((f, i) => {
      if (f.shot !== null && (f.shot < 1 || f.shot > c.shotCount)) {
        ctx.addIssue({ code: 'custom', path: ['fixes', i], message: `shot must be 1-${c.shotCount} or null` });
      }
      if (f.kind === 'regenerate_shot' && f.shot === null) {
        ctx.addIssue({ code: 'custom', path: ['fixes', i], message: 'regenerate_shot needs a shot number' });
      }
      if (hasPlaceholder(`${f.instruction} ${f.motion ?? ''}`)) {
        ctx.addIssue({ code: 'custom', path: ['fixes', i], message: 'No brackets or placeholders' });
      }
    });
  });
}

// ---------- Video prompt rewrite ----------

export const VideoPromptOutputSchema = z.object({ prompt: z.string() });

/** `required` are the shot markers and consistency sentences that must survive verbatim. */
export function videoPromptChecked(required: string[]) {
  return VideoPromptOutputSchema.superRefine((out, ctx) => {
    if (hasPlaceholder(out.prompt)) ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'No brackets or placeholders' });
    const lost = required.filter((r) => r.trim() && !out.prompt.includes(r.trim()));
    if (lost.length) {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: `Keep these verbatim: ${lost.map((l) => `"${l}"`).join(' ')}` });
    }
  });
}
