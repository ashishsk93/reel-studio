import { Injectable } from '@nestjs/common';
import { JevService, type JevChoiceAnswer, type JevQuestion } from './jev.service';

/** What a line of copy can claim; everything but `ok` breaks the copy rules. */
const FLAGS: Record<string, string> = {
  ok: 'Only states what can be seen (colour, pieces, pattern, print, occasion, styling) or her own excitement',
  feel: 'Claims how the fabric feels on the skin or how comfortable it is to wear',
  fit: 'Claims how it fits, its sizing, or that it is true to size',
  quality: 'Claims quality, durability or that it is well made',
  deal: 'Mentions a discount, sale, deal, offer or the lowest price',
  urgency: 'Invents urgency or stock levels, such as selling fast or limited stock',
  delivery: 'Promises delivery or shipping speed',
};

const MESSAGES: Record<string, string> = {
  feel: 'claims how the fabric feels or how comfortable it is',
  fit: 'claims fit or sizing',
  quality: 'claims quality',
  deal: 'mentions a discount or deal',
  urgency: 'invents urgency or stock levels',
  delivery: 'promises delivery',
};

/** Flag when Jev picks a rule-breaking option with at least this confidence. */
const MIN_CONFIDENCE = 0.5;

export interface CopyFlag {
  key: string;
  text: string;
  flag: string;
  confidence: number;
  /** "Teal kurti, so comfy" claims how the fabric feels or how comfortable it is */
  message: string;
}

/**
 * Copy guardrail on top of the word-list rules: Jev reads each line and catches paraphrased
 * claims ("melts on the skin", "runs a little big") that a regex misses. Returns nothing when
 * Jev isn't configured, so callers keep working with the word-list rules alone.
 */
@Injectable()
export class CopyGuardService {
  constructor(private readonly jev: JevService) {}

  get enabled(): boolean {
    return this.jev.enabled;
  }

  async check(texts: Array<{ key: string; text: string }>, projectId?: string | null): Promise<CopyFlag[]> {
    const lines = texts.filter((t) => t.text.trim());
    if (!this.jev.enabled || lines.length === 0) return [];
    const questions: Record<string, JevQuestion> = Object.fromEntries(
      lines.map((t, i) => [
        `q${i}`,
        {
          type: 'choice',
          instructions: {
            question: 'Which option best describes this line from her Reel? She is an AI influencer and has never touched or worn the product.',
            line: t.text,
          },
          criteria: FLAGS,
        } satisfies JevQuestion,
      ]),
    );
    const answers = await this.jev.ask({
      task: 'copy_guard',
      state: 'Copy for an Instagram fashion affiliate Reel (on-screen text, captions, DM replies). It may only describe what is visible, never how the clothes feel, fit or wear, and never deals, urgency or delivery.',
      questions,
      projectId,
    });
    if (!answers) return [];
    const flags: CopyFlag[] = [];
    lines.forEach((t, i) => {
      const a = answers[`q${i}`] as JevChoiceAnswer | undefined;
      if (!a || a.type !== 'choice' || a.choice === 'ok' || !MESSAGES[a.choice]) return;
      if (a.confidence < MIN_CONFIDENCE) return;
      flags.push({ key: t.key, text: t.text, flag: a.choice, confidence: a.confidence, message: `"${t.text}" ${MESSAGES[a.choice]}` });
    });
    return flags;
  }
}
