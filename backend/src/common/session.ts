import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '../menu/menu.service';

// The shared auth module must set request.user only after verifying a session.
// No request header or body value is accepted as identity here.
export type AuthenticatedRequest = Request & { user?: Session };

@Injectable()
export class VerifiedSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.userId || !request.user.role) throw new UnauthorizedException('Sesión requerida');
    return true;
  }
}
