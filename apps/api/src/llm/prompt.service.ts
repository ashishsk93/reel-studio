import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

export interface PromptFile {
  name: string;
  version: number;
  description: string;
  body: string;
}

/** Prompts are versioned .md files in src/prompts (copied to dist/prompts on build). */
export const DEFAULT_PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');

export function parsePromptFile(name: string, raw: string): PromptFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const meta: Record<string, string> = {};
  let body = raw;
  if (match) {
    body = match[2];
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return {
    name,
    version: Number(meta.version ?? 1),
    description: meta.description ?? '',
    body: body.trim(),
  };
}

/** Replaces {{key}} placeholders; a missing key is a bug, so it throws. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Template variable "${key}" was not provided`);
    return String(vars[key]);
  });
}

@Injectable()
export class PromptService {
  private readonly cache = new Map<string, PromptFile>();

  constructor(private readonly dir: string = DEFAULT_PROMPTS_DIR) {}

  /** `name` is a path under prompts/ without the extension, e.g. "persona" or "templates/image-wearing". */
  load(name: string): PromptFile {
    const cached = this.cache.get(name);
    if (cached && process.env.NODE_ENV === 'production') return cached;
    const file = path.join(this.dir, `${name}.md`);
    if (!fs.existsSync(file)) throw new Error(`Prompt file not found: ${file}`);
    const parsed = parsePromptFile(name, fs.readFileSync(file, 'utf8'));
    this.cache.set(name, parsed);
    return parsed;
  }

  render(name: string, vars: Record<string, string | number> = {}): string {
    return renderTemplate(this.load(name).body, vars);
  }
}
