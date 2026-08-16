import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { PasswordService } from './password.service';
import { SessionAdapter } from './session.adapter';

type Response = {
  cookie: (...args: unknown[]) => void;
  clearCookie: (...args: unknown[]) => void;
  send: () => unknown;
};
type Request = AuthenticatedRequest & {
  headers: { cookie?: string; 'x-csrf-token'?: string };
};

const attempts = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
const WINDOW = 15 * 60_000;
function normalizedEmail(value: unknown): string {
  if (typeof value !== 'string')
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted fields.',
    });
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted fields.',
    });
  return email;
}
function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted fields.',
    });
  return value;
}
function rate(key: string) {
  const now = Date.now();
  const item = attempts.get(key);
  if (!item || item.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW });
    return;
  }
  if (++item.count > LIMIT)
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Try again later.',
      },
      429,
    );
}
function cookie(res: Response, token: string, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60_000,
  });
}
function clearCookie(res: Response, secure: boolean) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie('aio_csrf', { secure, sameSite: 'lax', path: '/' });
}
function csrfCookie(res: Response, token: string, secure: boolean) {
  res.cookie('aio_csrf', token, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60_000,
  });
}
function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  return cookieHeader?.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
}
function requireCsrf(req: Request) {
  const cookieToken = cookieValue(req.headers.cookie, 'aio_csrf');
  const headerToken = req.headers['x-csrf-token'];
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length ||
    !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    throw new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Please sign in to continue.',
    });
  }
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionAdapter,
  ) {}
  @Post('register') async register(
    @Body() body: { email?: unknown; password?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = normalizedEmail(body.email);
    const secret = password(body.password);
    rate(`register:${email}`);
    const hash = await this.passwords.hash(secret);
    try {
      const user = await this.db.user.create({
        data: {
          authProvider: 'LOCAL',
          providerSubject: email,
          email,
          passwordHash: hash,
          status: 'ACTIVE',
        },
      });
      const issued = await this.sessions.createSession(user.userId, {
        expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
      });
      cookie(res, issued.token, process.env.APP_ENV === 'production');
      csrfCookie(
        res,
        randomBytes(32).toString('base64url'),
        process.env.APP_ENV === 'production',
      );
      return {
        user: {
          userId: user.userId,
          sessionId: issued.session.sessionId,
          email,
        },
      };
    } catch {
      throw new ConflictException({
        code: 'IDENTITY_EXISTS',
        message: 'An account with those details already exists.',
      });
    }
  }
  @Post('login') @HttpCode(200) async login(
    @Body() body: { email?: unknown; password?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = normalizedEmail(body.email);
    const secret = password(body.password);
    rate(`login:${req.ip}:${email}`);
    const user = await this.db.user.findFirst({
      where: { authProvider: 'LOCAL', providerSubject: email },
      select: { userId: true, email: true, passwordHash: true, status: true },
    });
    const valid = await this.passwords.verify(
      secret,
      user?.passwordHash ?? null,
    );
    if (!user || !valid || user.status !== 'ACTIVE')
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password.',
      });
    const issued = await this.sessions.createSession(user.userId, {
      expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
    });
    cookie(res, issued.token, process.env.APP_ENV === 'production');
    csrfCookie(
      res,
      randomBytes(32).toString('base64url'),
      process.env.APP_ENV === 'production',
    );
    return {
      user: {
        userId: user.userId,
        sessionId: issued.session.sessionId,
        email: user.email,
      },
    };
  }
  @Post('logout') @HttpCode(204) async logout(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    requireCsrf(req);
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.revokeSession(token);
    clearCookie(res, process.env.APP_ENV === 'production');
    return res.send();
  }
  @Post('reset-request') @HttpCode(202) async resetRequest(
    @Body() body: { email?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const email = normalizedEmail(body.email);
    rate(`reset:${req.ip}:${email}`);
    const user = await this.db.user.findFirst({
      where: { authProvider: 'LOCAL', providerSubject: email },
      select: { userId: true },
    });
    if (user) {
      const raw = randomBytes(32).toString('base64url');
      await this.db.passwordResetToken.create({
        data: {
          userId: user.userId,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
    }
    return {
      message: 'If an account exists, reset instructions will be sent.',
    };
  }
  @Post('reset-complete') @HttpCode(200) async resetComplete(
    @Body() body: { token?: unknown; password?: unknown },
  ) {
    if (typeof body.token !== 'string' || body.token.length < 20)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'The reset link is invalid or expired.',
      });
    const secret = password(body.password);
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const now = new Date();
    const reset = await this.db.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      select: { resetTokenId: true, userId: true },
    });
    if (!reset)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'The reset link is invalid or expired.',
      });
    const hash = await this.passwords.hash(secret);
    await this.db.transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          resetTokenId: reset.resetTokenId,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException({
          code: 'UNAUTHENTICATED',
          message: 'The reset link is invalid or expired.',
        });
      await tx.user.update({
        where: { userId: reset.userId },
        data: { passwordHash: hash },
      });
      await tx.session.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    return { message: 'Password reset successfully.' };
  }
  @Get('me') @UseGuards(AuthGuard) async me(@Req() req: AuthenticatedRequest) {
    const roles = await this.db.userRole.findMany({
      where: { userId: req.auth!.userId, status: 'ACTIVE' },
      select: { role: true },
    });
    return {
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      roles: roles.map(({ role }) => role),
    };
  }
}
