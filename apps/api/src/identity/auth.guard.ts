import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from './auth.types';
import { SessionAdapter } from './session.adapter';
import { DatabaseService } from '../database/database.service';

export const SESSION_COOKIE = 'aio_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionAdapter,
    private readonly database: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.cookie?.match(
      new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`),
    )?.[1];
    if (!token)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Please sign in to continue.',
      });
    const session = await this.sessions.resolveActiveSession(token);
    if (!session)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Please sign in to continue.',
      });
    const user = await this.database.user.findUnique({
      where: { userId: session.userId },
      select: { userId: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Please sign in to continue.',
      });
    request.auth = {
      userId: user.userId,
      sessionId: session.sessionId,
      status: 'ACTIVE',
    };
    return true;
  }
}
