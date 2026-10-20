import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env';
import { AuthController } from './auth.controller';
import { hashPassword } from './session';

const config = loadConfig({
  repoRoot: '/repo',
  env: { AUTH_USERNAME: 'ashish', AUTH_PASSWORD_HASH: hashPassword('a long secret pass'), AUTH_SECRET: 'k', PUBLIC_URL: 'https://studio.velra.tech' },
});
const req = (cookie?: string, ip = '203.0.113.9') => ({ headers: { cookie, 'x-real-ip': ip }, ip: '127.0.0.1' }) as unknown as Request;
function res() {
  const headers: Record<string, string> = {};
  return { headers, r: { setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v) } as unknown as Response };
}

describe('AuthController', () => {
  const auth = new AuthController(config);

  it('signs in with the right username and password and the session passes the check', async () => {
    const { headers, r } = res();
    await auth.login({ username: 'ashish', password: 'a long secret pass' }, req(), r);
    const cookie = headers['set-cookie']!;
    expect(cookie).toMatch(/^rs_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    const token = cookie.split(';')[0]!;
    expect(() => auth.check(req(token))).not.toThrow();
    expect(auth.status(req(token))).toEqual({ enabled: true, signedIn: true });
  });

  it('rejects a wrong password or username, and the check without a session', async () => {
    await expect(auth.login({ username: 'ashish', password: 'nope' }, req(), res().r)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.login({ username: 'admin', password: 'a long secret pass' }, req(), res().r)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(() => auth.check(req())).toThrow(UnauthorizedException);
    expect(() => auth.check(req('rs_session=forged.sig'))).toThrow(UnauthorizedException);
    expect(auth.status(req())).toEqual({ enabled: true, signedIn: false });
  });

  it('lets everything through when sign-in is off (local use)', () => {
    const local = new AuthController(loadConfig({ repoRoot: '/repo', env: {} }));
    expect(() => local.check(req())).not.toThrow();
    expect(local.status(req())).toEqual({ enabled: false, signedIn: true });
  });
});
