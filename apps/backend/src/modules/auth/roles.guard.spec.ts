import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { AuthorizationService } from './authorization.service';
import { RolesGuard } from './roles.guard';
import { REQUIRED_ROLES } from './auth.decorators';
import { AuthContext } from './auth.types';

const handler = () => undefined;
class FakeController {}

function contextWith(user?: AuthContext): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let authorization: AuthorizationService;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    authorization = new AuthorizationService(undefined);
    guard = new RolesGuard(reflector, authorization);
    Reflect.deleteMetadata(REQUIRED_ROLES, handler);
  });

  function requireRoles(roles: Role[]): void {
    Reflect.defineMetadata(REQUIRED_ROLES, roles, handler);
  }

  it('allows any authenticated user when no roles are required', () => {
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'VIEWER' }))).toBe(true);
  });

  it('allows a role above the requirement (hierarchy)', () => {
    requireRoles(['AGENT']);
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'MANAGER' }))).toBe(true);
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'ADMIN' }))).toBe(true);
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'OWNER' }))).toBe(true);
  });

  it('allows the exact required role', () => {
    requireRoles(['AGENT']);
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'AGENT' }))).toBe(true);
  });

  it('denies roles below the requirement', () => {
    requireRoles(['MANAGER']);
    expect(() => guard.canActivate(contextWith({ userId: 'u', role: 'VIEWER' }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextWith({ userId: 'u', role: 'AGENT' }))).toThrow(
      ForbiddenException,
    );
  });

  it('denies by default when the user has no role claim', () => {
    requireRoles(['VIEWER']);
    expect(() => guard.canActivate(contextWith({ userId: 'u' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });

  it('denies unknown role values', () => {
    requireRoles(['VIEWER']);
    expect(() => guard.canActivate(contextWith({ userId: 'u', role: 'GHOST' as Role }))).toThrow(
      ForbiddenException,
    );
  });

  it('satisfies when the user matches any one of several required roles', () => {
    requireRoles(['ADMIN', 'VIEWER']);
    expect(guard.canActivate(contextWith({ userId: 'u', role: 'VIEWER' }))).toBe(true);
  });
});
