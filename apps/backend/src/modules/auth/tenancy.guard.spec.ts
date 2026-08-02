import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { TenancyGuard } from './tenancy.guard';
import { AuthContext } from './auth.types';

function contextWith(user?: AuthContext): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('TenancyGuard', () => {
  const assertMembership = jest.fn<Promise<boolean>, [string, string]>();
  const authorization = { assertMembership } as unknown as AuthorizationService;
  const guard = new TenancyGuard(authorization);

  beforeEach(() => jest.resetAllMocks());

  it('denies requests without tenant claims or unproven membership', async () => {
    await expect(guard.canActivate(contextWith(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(contextWith({ userId: 'u' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      guard.canActivate(contextWith({ userId: 'u', organizationId: 'org' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies users that are not members of the organization', async () => {
    assertMembership.mockResolvedValue(false);
    await expect(
      guard.canActivate(contextWith({ userId: 'u', organizationId: 'org-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows active members of the organization', async () => {
    assertMembership.mockResolvedValue(true);
    await expect(
      guard.canActivate(contextWith({ userId: 'u', organizationId: 'org-1' })),
    ).resolves.toBe(true);
    expect(assertMembership).toHaveBeenCalledWith('org-1', 'u');
  });
});
