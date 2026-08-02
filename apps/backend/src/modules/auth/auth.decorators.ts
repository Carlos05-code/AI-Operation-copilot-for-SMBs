/**
 * Role metadata + decorators for route-level authorization (SECURITY_SPEC §4).
 */
import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { AuthContext, AuthenticatedRequest } from './auth.types';

export const REQUIRED_ROLES = 'auth:requiredRoles';

/** Requires the authenticated user to hold at least one of the given roles. */
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Exposes the verified AuthContext of the current request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext | undefined => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
