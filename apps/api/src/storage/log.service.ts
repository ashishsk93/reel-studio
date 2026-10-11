import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from './storage.service';

export type LogChannel = 'llm' | 'ffmpeg' | 'jobs';

/**
 * Appends JSON lines to data/projects/{id}/logs/{channel}.log, or data/logs/{channel}.log
 * when the entry isn't tied to a project.
 */
@Injectable()
export class LogService {
  private readonly logger = new Logger('ProjectLog');
  private readonly created = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageService) {}

  write(channel: LogChannel, projectId: string | null | undefined, entry: Record<string, unknown>): void {
    const rel = projectId ? `projects/${projectId}/logs/${channel}.log` : `logs/${channel}.log`;
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
    // Serialised so lines from concurrent jobs never interleave.
    this.chain = this.chain
      .then(async () => {
        const file = this.storage.abs(rel);
        const dir = path.dirname(file);
        if (!this.created.has(dir)) {
          await fs.mkdir(dir, { recursive: true });
          this.created.add(dir);
        }
        await fs.appendFile(file, line, 'utf8');
      })
      .catch((error: unknown) => this.logger.warn(`Could not write ${rel}: ${String(error)}`));
  }

  /** Resolves once pending writes are flushed (used by tests). */
  flush(): Promise<void> {
    return this.chain;
  }
}
