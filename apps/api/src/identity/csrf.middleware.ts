import { timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

type Request = { method: string; headers: { cookie?: string; 'x-csrf-token'?: string | string[] } };
type Response = unknown;
type NextFunction = () => void;

const SESSION_COOKIE = 'aio_session';
const CSRF_COOKIE = 'aio_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieValue(header: string | undefined, name: string) {
  return header?.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
}

@Injectable()
export class CsrfMiddleware {
  use(request: Request, _response: Response, next: NextFunction) {
    if (SAFE_METHODS.has(request.method)) return next();
    if (!cookieValue(request.headers.cookie, SESSION_COOKIE)) return next();

    const cookieToken = cookieValue(request.headers.cookie, CSRF_COOKIE);
    const headerToken = request.headers['x-csrf-token'];
    const header = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (
      !cookieToken ||
      !header ||
      cookieToken.length !== header.length ||
      !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(header))
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Please sign in to continue.',
      });
    }
    return next();
  }
}
