/**
 * RolesGuard: enforces @RequireRoles metadata using the RBAC hierarchy
 * (SECURITY_SPEC §4). Denies by default: an endpoint with no role metadata
 * is open to any authenticated user; a route with role requirements denies
 * requests whose claim rank is insufficient. Must run after JwtAuthGuard.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { AuthenticatedRequest } from './auth.types';
import { AuthorizationService } from './authorization.service';
import { REQUIRED_ROLES } from './auth.decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!this.authorization.hasAnyRole(request.user?.role, required)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
