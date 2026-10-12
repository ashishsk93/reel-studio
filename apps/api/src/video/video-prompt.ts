import { hasPlaceholder, type SettingValue } from '@reel/shared';
import { renderTemplate, type PromptService } from '../llm/prompt.service';
import { forbiddenReminder, sentence, tidyPrompt } from '../influencers/persona-text';

export type MultiShotTemplate = SettingValue<'video.multiShotTemplate'>;

/** 3 → "3", 5.5 → "5.5" */
export function fmtSec(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export interface PromptShot {
  start: number;
  end: number;
  description: string;
  motion: string;
}

export class VideoPromptError extends Error {}

/** "Shot 2 (3–6s):" — the marker a rewrite must keep. */
export function shotMarker(index: number, shot: { start: number; end: number }): string {
  return `Shot ${index} (${fmtSec(shot.start)}–${fmtSec(shot.end)}s):`;
}

function render(template: string, vars: Record<string, string | number>, what: string): string {
  try {
    return renderTemplate(template, vars);
  } catch (error) {
    throw new VideoPromptError(`The ${what} template in Settings is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Kling multi-shot prompt: one line per shot with its timing, a hard-cut marker between shots,
 * then the consistency footer. Built from the editable template in Settings.
 */
export function buildMultiShotPrompt(
  template: MultiShotTemplate,
  input: { name: string; forbiddenFeatures: string[]; shots: PromptShot[] },
): string {
  const first = input.name.split(' ')[0] || input.name;
  const lines = input.shots.map((shot, i) => {
    const line = tidyPrompt(
      render(
        template.shotLine,
        {
          index: i + 1,
          start: fmtSec(shot.start),
          end: fmtSec(shot.end),
          description: sentence(shot.description),
          motion: sentence(shot.motion),
        },
        'shot line',
      ),
    );
    return i < input.shots.length - 1 && template.cutMarker.trim() ? `${line} ${template.cutMarker.trim()}` : line;
  });
  const footer = tidyPrompt(
    render(template.footer, { name: first, forbiddenReminder: forbiddenReminder(input.forbiddenFeatures) }, 'footer'),
  );
  const prompt = [...lines, '', footer].join('\n').trim();
  if (hasPlaceholder(prompt)) throw new VideoPromptError('The video prompt contains brackets or a placeholder.');
  return prompt;
}

/** Single-scene image-to-video prompt (section 9 pattern). */
export function buildSinglePrompt(input: { name: string; forbiddenFeatures: string[]; motion: string }, prompts: PromptService): string {
  const first = input.name.split(' ')[0] || input.name;
  const prompt = tidyPrompt(
    prompts.render('templates/video-single', {
      motion: sentence(input.motion || 'She holds still with a soft, natural smile, breathing gently'),
      name: first,
      forbiddenReminder: forbiddenReminder(input.forbiddenFeatures),
    }),
  );
  if (hasPlaceholder(prompt)) throw new VideoPromptError('The video prompt contains brackets or a placeholder.');
  return prompt;
}
