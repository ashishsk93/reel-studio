import { describe, expect, it } from 'vitest';
import { cookieValue, createSession, hashPassword, readSession, sameText, sessionCookie, verifyPassword } from './session';

describe('passwords', () => {
  it('verifies the right password only', () => {
    const stored = hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('correct hors', stored)).toBe(false);
    expect(verifyPassword('correct horse', 'nonsense')).toBe(false);
  });

  it('salts every hash', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });

  it('compares usernames exactly', () => {
    expect(sameText('ashish', 'ashish')).toBe(true);
    expect(sameText('ashish', 'Ashish')).toBe(false);
  });
});

describe('sessions', () => {
  const now = Date.UTC(2026, 9, 20);

  it('round-trips and expires after 30 days', () => {
    const token = createSession('s', 'ashish', now);
    expect(readSession('s', token, now)).toBe('ashish');
    expect(readSession('s', token, now + 29 * 86_400_000)).toBe('ashish');
    expect(readSession('s', token, now + 31 * 86_400_000)).toBeNull();
  });

  it('rejects other secrets, tampering and junk', () => {
    const token = createSession('s', 'ashish', now);
    expect(readSession('other', token, now)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'ashish', exp: now + 10 ** 12 })).toString('base64url');
    expect(readSession('s', `${forged}.${sig}`, now)).toBeNull();
    expect(readSession('s', `${body}.`, now)).toBeNull();
    expect(readSession('s', 'junk', now)).toBeNull();
    expect(readSession('s', undefined, now)).toBeNull();
    expect(readSession('', token, now)).toBeNull();
  });

  it('reads the cookie out of a header and sets it securely', () => {
    expect(cookieValue('a=1; rs_session=abc.def; b=2', 'rs_session')).toBe('abc.def');
    expect(cookieValue('a=1', 'rs_session')).toBeUndefined();
    expect(sessionCookie('t', true)).toBe('rs_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
  });
});
