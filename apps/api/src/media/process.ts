import { spawn } from 'node:child_process';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onStderrLine?: (line: string) => void;
}

/** Runs a binary with an argument array (never a shell string) and collects its output. */
export function runProcess(command: string, args: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal: options.signal });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      : undefined;

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
      if (!options.onStderrLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      lines.filter(Boolean).forEach(options.onStderrLine);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending && options.onStderrLine) options.onStderrLine(pending);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

/** First line of `<bin> -version`, or null when the binary can't be run. */
export async function binaryVersion(command: string): Promise<string | null> {
  try {
    const result = await runProcess(command, ['-version'], { timeoutMs: 10_000 });
    if (result.code !== 0) return null;
    return result.stdout.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}
