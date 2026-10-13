import { Injectable } from '@nestjs/common';
import { DecisionService, probabilityOf, type ChoiceAnswer, type DecisionQuestion } from './decision.service';

/** What a line of copy can claim; everything but `ok` breaks the copy rules. */
const CHOICES: Array<{ value: string; description: string }> = [
  { value: 'ok', description: 'Only states what can be seen (colour, pieces, pattern, print, occasion, styling) or her own excitement' },
  { value: 'feel', description: 'Claims how the fabric feels on the skin or how comfortable it is to wear' },
  { value: 'fit', description: 'Claims how it fits, its sizing, or that it is true to size' },
  { value: 'quality', description: 'Claims quality, durability or that it is well made' },
  { value: 'deal', description: 'Mentions a discount, sale, deal, offer or the lowest price' },
  { value: 'urgency', description: 'Invents urgency or stock levels, such as selling fast or limited stock' },
  { value: 'delivery', description: 'Promises delivery or shipping speed' },
];

const MESSAGES: Record<string, string> = {
  feel: 'claims how the fabric feels or how comfortable it is',
  fit: 'claims fit or sizing',
  quality: 'claims quality',
  deal: 'mentions a discount or deal',
  urgency: 'invents urgency or stock levels',
  delivery: 'promises delivery',
};

/**
 * Flag when the "ok" option gets less than this probability. Choice probabilities from the
 * Decisions API run high, so this is deliberately strict about what counts as a claim.
 */
const MAX_OK_PROBABILITY = 0.3;

export interface CopyFlag {
  key: string;
  text: string;
  flag: string;
  confidence: number;
  /** "Melts on the skin" claims how the fabric feels or how comfortable it is */
  message: string;
}

/**
 * Copy guardrail on top of the word-list rules: the decision model reads each line and catches
 * paraphrased claims ("melts on the skin", "runs a little big") that a regex misses. Returns
 * nothing when decisions are off, so callers keep working with the word-list rules alone.
 */
@Injectable()
export class CopyGuardService {
  constructor(private readonly decisions: DecisionService) {}

  get enabled(): boolean {
    return this.decisions.enabled;
  }

  async check(texts: Array<{ key: string; text: string }>, projectId?: string | null): Promise<CopyFlag[]> {
    const lines = texts.filter((t) => t.text.trim());
    if (!this.decisions.enabled || lines.length === 0) return [];
    const questions: DecisionQuestion[] = lines.map((t, i) => ({
      type: 'choice',
      name: `line${i}`,
      instructions: `Which option best describes this line from her Reel: "${t.text}"`,
      choices: CHOICES,
    }));
    const answers = await this.decisions.ask({
      task: 'copy_guard',
      input:
        'Copy for an Instagram fashion affiliate Reel by an AI influencer who has never touched or worn the product. It may only describe what is visible, never how the clothes feel, fit or wear, and never deals, urgency or delivery.',
      questions,
      projectId,
    });
    if (!answers) return [];
    const flags: CopyFlag[] = [];
    lines.forEach((t, i) => {
      const a = answers.get(`line${i}`) as ChoiceAnswer | undefined;
      if (!a || a.type !== 'choice' || a.choice === 'ok' || !MESSAGES[a.choice]) return;
      if (probabilityOf(a, 'ok') > MAX_OK_PROBABILITY) return;
      flags.push({ key: t.key, text: t.text, flag: a.choice, confidence: a.confidence, message: `"${t.text}" ${MESSAGES[a.choice]}` });
    });
    return flags;
  }
}
