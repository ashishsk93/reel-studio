import { z } from 'zod';
import { BoxSchema, type Box } from './review.js';
import { hasPlaceholder } from './product.js';

/**
 * Copy rules shared by every generated text: the influencer never touched the product, so no
 * feel, fit, quality, comfort or sizing claims; no invented discounts, urgency or delivery promises.
 */
const COPY_RULES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\b(soft|silky|buttery|comfy|comfortable|breathable|lightweight|stretchy|itchy)\b|\bfeels? (so |super |really )?(soft|smooth|light|amazing|good|nice|great|luxurious)\b/i,
    message: 'no claims about how the fabric feels or how comfortable it is',
  },
  { pattern: /\b(fits? (perfectly|so well|like a dream|true)|true to size|runs (small|large|big)|sizing|perfect fit|flattering fit)\b/i, message: 'no claims about fit or sizing' },
  { pattern: /\b(great|premium|high|amazing|top|good|best|superb|excellent) quality\b|\bwell[- ]made\b|\bdurable\b/i, message: 'no claims about quality' },
  { pattern: /\b\d+\s?% off\b|\bdiscount|\bsale\b|\bdeal\b|\boffer\b|\blowest price|\bcheapest\b|\bsteal\b/i, message: 'no discounts, deals or price claims' },
  { pattern: /\b(selling fast|limited stock|hurry|only \d+ left|before it'?s gone|sold out)\b/i, message: 'no invented urgency or stock levels' },
  { pattern: /\b(deliver(y|ed|s)? (in|by|within)|arrives? (in|by|within)|next[- ]day|same[- ]day|fast delivery|free delivery|free shipping)\b/i, message: 'no delivery promises' },
];

export function copyRuleIssues(text: string): string[] {
  return COPY_RULES.filter((r) => r.pattern.test(text)).map((r) => `"${text.match(r.pattern)?.[0]}": ${r.message}`);
}

// ---------- Captions ----------

export const CaptionsOutputSchema = z.object({
  hook: z.string().describe('First line of the caption, in her voice, scroll-stopping, at most 12 words, one emoji allowed'),
  outfitLines: z.array(z.string()).describe('1-2 short lines about the outfit, factual, only from the spec'),
  hashtags: z.array(z.string()).describe('5-10 hashtags including #SlayUrbanSociety and her own tag, plus occasion and product tags'),
  firstComment: z.string().nullable().describe('Optional first comment, e.g. a question to start replies; null if none'),
  dmMessage: z.string().describe('The DM reply when someone comments LINK, in her voice, 1-3 short sentences, without the link itself'),
});
export type CaptionsOutput = z.infer<typeof CaptionsOutputSchema>;

export function captionsChecked(requiredTags: string[]) {
  return CaptionsOutputSchema.superRefine((out, ctx) => {
    const texts = { hook: out.hook, outfitLines: out.outfitLines.join(' '), firstComment: out.firstComment ?? '', dmMessage: out.dmMessage };
    for (const [path, text] of Object.entries(texts)) {
      for (const message of copyRuleIssues(text)) ctx.addIssue({ code: 'custom', path: [path], message });
      if (hasPlaceholder(text)) ctx.addIssue({ code: 'custom', path: [path], message: 'No brackets or placeholders' });
      if (/https?:\/\//i.test(text)) ctx.addIssue({ code: 'custom', path: [path], message: 'No links; the app inserts the link' });
    }
    if (out.outfitLines.length < 1 || out.outfitLines.length > 2) ctx.addIssue({ code: 'custom', path: ['outfitLines'], message: 'Give 1-2 lines' });
    if (out.hashtags.length < 5 || out.hashtags.length > 10) ctx.addIssue({ code: 'custom', path: ['hashtags'], message: `Give 5-10 hashtags (got ${out.hashtags.length})` });
    const bad = out.hashtags.filter((h) => !/^#[\p{L}\p{N}_]+$/u.test(h));
    if (bad.length) ctx.addIssue({ code: 'custom', path: ['hashtags'], message: `Hashtags are # plus letters/numbers only: ${bad.join(' ')}` });
    const lower = out.hashtags.map((h) => h.toLowerCase());
    const missing = requiredTags.filter((t) => !lower.includes(t.toLowerCase()));
    if (missing.length) ctx.addIssue({ code: 'custom', path: ['hashtags'], message: `Include ${missing.join(' and ')}` });
  });
}

// ---------- Cover ----------

export const CoverPickOutputSchema = z.object({
  best: z.number().int().describe('Number of the best candidate frame (1-based, as labelled)'),
  reason: z.string().describe('One sentence'),
  titles: z.array(z.string()).describe('Exactly 3 cover titles, 2-5 words each, in her voice; at most one emoji'),
});
export type CoverPickOutput = z.infer<typeof CoverPickOutputSchema>;

export function coverPickChecked(candidateCount: number) {
  return CoverPickOutputSchema.superRefine((out, ctx) => {
    if (out.best < 1 || out.best > candidateCount) ctx.addIssue({ code: 'custom', path: ['best'], message: `best must be 1-${candidateCount}` });
    if (out.titles.length !== 3) ctx.addIssue({ code: 'custom', path: ['titles'], message: 'Give exactly 3 titles' });
    out.titles.forEach((t, i) => {
      const words = t.trim().split(/\s+/).length;
      if (words > 6 || t.length > 36) ctx.addIssue({ code: 'custom', path: ['titles', i], message: 'Keep titles to 2-5 words' });
      for (const message of copyRuleIssues(t)) ctx.addIssue({ code: 'custom', path: ['titles', i], message });
      if (hasPlaceholder(t)) ctx.addIssue({ code: 'custom', path: ['titles', i], message: 'No placeholders' });
    });
  });
}

// ---------- Garment detail regions (badge placement) ----------

export const DetailRegionsOutputSchema = z.object({
  regions: z
    .array(z.object({ label: z.string().describe('e.g. "neckline embroidery"'), box: BoxSchema }))
    .describe('The garment areas a buyer most needs to see (from the must-match list), normalised boxes; empty if the garment is not visible'),
});
export type DetailRegionsOutput = z.infer<typeof DetailRegionsOutputSchema>;

const inFrame = (b: Box) => [b.x, b.y, b.w, b.h, b.x + b.w, b.y + b.h].every((v) => v >= -0.001 && v <= 1.001) && b.w > 0 && b.h > 0;

export const DetailRegionsChecked = DetailRegionsOutputSchema.superRefine((out, ctx) => {
  if (out.regions.length > 4) ctx.addIssue({ code: 'custom', path: ['regions'], message: 'At most 4 regions' });
  out.regions.forEach((r, i) => {
    if (!inFrame(r.box)) ctx.addIssue({ code: 'custom', path: ['regions', i], message: 'Boxes are normalised: values and x+w, y+h within 0-1' });
  });
});

export const PlacementCheckOutputSchema = z.object({
  ok: z.boolean().describe('true if the badge covers none of: her face, the hands holding the product, the key garment detail'),
  note: z.string().describe('One sentence: what it covers, or "clear"'),
});
