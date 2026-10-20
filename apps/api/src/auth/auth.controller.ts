import { Body, Controller, Get, HttpCode, Inject, Logger, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { SESSION_COOKIE, clearedCookie, cookieValue, createSession, readSession, sameText, sessionCookie, verifyPassword } from './session';

const LoginSchema = z.object({ username: z.string().max(200), password: z.string().max(500) });

/**
 * Sign-in for the hosted app. nginx asks GET /auth/check before every request
 * (auth_request) and sends visitors without a session to the /login page.
 * Failed attempts are logged as `AUTH-FAIL ip=…`, which fail2ban watches.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get secure(): boolean {
    return this.config.publicUrl.startsWith('https://');
  }

  /** Whether sign-in is on (it's off locally) and whether this browser is signed in. */
  @Get('status')
  status(@Req() req: Request) {
    const { enabled, secret } = this.config.auth;
    return { enabled, signedIn: !enabled || readSession(secret, cookieValue(req.headers.cookie, SESSION_COOKIE)) !== null };
  }

  /** For nginx auth_request: 204 lets the request through, 401 sends it to /login. */
  @Get('check')
  @HttpCode(204)
  check(@Req() req: Request): void {
    const { enabled, secret } = this.config.auth;
    if (enabled && readSession(secret, cookieValue(req.headers.cookie, SESSION_COOKIE)) === null) throw new UnauthorizedException();
  }

  @Post('login')
  @HttpCode(204)
  async login(@Body(new ZodPipe(LoginSchema)) body: z.output<typeof LoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const { enabled, username, passwordHash, secret } = this.config.auth;
    if (!enabled) throw new NotFoundException('Sign-in is off');
    // Always hash, so a wrong username takes as long as a wrong password.
    const passwordOk = verifyPassword(body.password, passwordHash);
    if (!(sameText(body.username, username) && passwordOk)) {
      // The API listens on loopback only, so X-Real-IP is nginx's word for the client address.
      const ip = (req.headers['x-real-ip'] as string | undefined) ?? req.ip ?? 'unknown';
      this.logger.warn(`AUTH-FAIL ip=${ip} user=${JSON.stringify(body.username.slice(0, 40))}`);
      await new Promise((r) => setTimeout(r, 400));
      throw new UnauthorizedException('Wrong username or password');
    }
    res.setHeader('Set-Cookie', sessionCookie(createSession(secret, username), this.secure));
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.setHeader('Set-Cookie', clearedCookie(this.secure));
  }
}
