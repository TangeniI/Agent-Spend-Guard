import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Fails closed: with no API_SERVICE_TOKEN configured, every request is refused. */
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.API_SERVICE_TOKEN;
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const supplied = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!expected || !supplied || !timingSafeEqual(digest(supplied), digest(expected))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
