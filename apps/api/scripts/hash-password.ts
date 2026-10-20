/**
 * Prints an AUTH_PASSWORD_HASH and a fresh AUTH_SECRET for .env.
 *   pnpm --filter @reel/api auth:hash
 * Asks for the password twice without echoing it.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/session';

// Typed characters are buffered across prompts, so piped input (both lines at once) works too.
let buffered = '';
const waiting: Array<(line: string) => void> = [];
const lines: string[] = [];
let started = false;

function start(): void {
  if (started) return;
  started = true;
  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  let afterCr = false;
  stdin.on('data', (chunk: string) => {
    for (const ch of chunk) {
      const cr = afterCr;
      afterCr = ch === '\r';
      if (ch === '\u0003') process.exit(130);
      if (ch === '\n' && cr) continue; // the \n of a \r\n pair
      if (ch === '\r' || ch === '\n') {
        const line = buffered;
        buffered = '';
        process.stdout.write('\n');
        const resolve = waiting.shift();
        if (resolve) resolve(line);
        else lines.push(line);
      } else if (ch === '\u007f' || ch === '\b') buffered = buffered.slice(0, -1);
      else buffered += ch;
    }
  });
}

function ask(question: string): Promise<string> {
  process.stdout.write(question);
  start();
  const ready = lines.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  return new Promise((resolve) => waiting.push(resolve));
}

async function main(): Promise<void> {
  const password = await ask('New password: ');
  if (password.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
  }
  if ((await ask('Again: ')) !== password) {
    console.error("They don't match.");
    process.exit(1);
  }
  console.log('\nAdd these to .env (keep AUTH_USERNAME as you like):\n');
  console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
  console.log(`AUTH_SECRET=${randomBytes(32).toString('base64url')}`);
  process.exit(0);
}

void main();
