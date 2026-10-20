import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Single-user sign-in for the hosted app. The password is stored as an scrypt hash
 * (AUTH_PASSWORD_HASH, made with `pnpm --filter @reel/api auth:hash`) and a session
 * is an HMAC-signed cookie, so nothing about sessions lives in the database.
 */

export const SESSION_COOKIE = 'rs_session';
export const SESSION_DAYS = 30;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;

/** `scrypt$N$r$p$salt$hash` (salt and hash base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Compares without leaking where two strings first differ. */
export function sameText(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function createSession(secret: string, user: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: user, exp: now + SESSION_DAYS * 86_400_000 })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/** The signed-in user, or null for a missing, forged or expired session. */
export function readSession(secret: string, token: string | undefined, now = Date.now()): string | null {
  if (!secret || !token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u?: unknown; exp?: unknown };
    return typeof u === 'string' && typeof exp === 'number' && exp > now ? u : null;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`;
}

export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
