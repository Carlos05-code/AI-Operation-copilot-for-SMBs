import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  describe('roleRank / hasRole', () => {
    const service = new AuthorizationService(undefined);

    it('orders roles owner > admin > manager > agent > viewer', () => {
      expect(service.roleRank('OWNER')).toBeGreaterThan(service.roleRank('ADMIN'));
      expect(service.roleRank('ADMIN')).toBeGreaterThan(service.roleRank('MANAGER'));
      expect(service.roleRank('MANAGER')).toBeGreaterThan(service.roleRank('AGENT'));
      expect(service.roleRank('AGENT')).toBeGreaterThan(service.roleRank('VIEWER'));
      expect(service.roleRank('VIEWER')).toBeGreaterThanOrEqual(0);
    });

    it('ranks unknown or missing roles below viewer (fail closed)', () => {
      expect(service.roleRank(undefined)).toBe(-1);
      expect(service.roleRank('GHOST')).toBe(-1);
      expect(service.hasRole('GHOST', 'VIEWER')).toBe(false);
      expect(service.hasRole(undefined, 'VIEWER')).toBe(false);
    });

    it('hasRole satisfies same and higher roles only', () => {
      expect(service.hasRole('VIEWER', 'VIEWER')).toBe(true);
      expect(service.hasRole('OWNER', 'VIEWER')).toBe(true);
      expect(service.hasRole('AGENT', 'MANAGER')).toBe(false);
    });

    it('hasAnyRole matches any of the required roles', () => {
      expect(service.hasAnyRole('MANAGER', ['ADMIN', 'MANAGER'])).toBe(true);
      expect(service.hasAnyRole('AGENT', ['ADMIN', 'MANAGER'])).toBe(false);
      expect(service.hasAnyRole('OWNER', [])).toBe(false);
    });
  });

  describe('membership checks', () => {
    const prisma = {
      member: {
        findUnique: jest.fn(),
      },
    };

    it('asserts membership for an existing member row', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1' });
      const service = new AuthorizationService(prisma as never);
      await expect(service.assertMembership('org-1', 'u-1')).resolves.toBe(true);
      expect(prisma.member.findUnique).toHaveBeenCalledWith({
        where: { organizationId_userId: { organizationId: 'org-1', userId: 'u-1' } },
        select: { id: true },
      });
    });

    it('denies when the user is not a member', async () => {
      prisma.member.findUnique.mockResolvedValue(null);
      const service = new AuthorizationService(prisma as never);
      await expect(service.assertMembership('org-1', 'u-1')).resolves.toBe(false);
    });

    it('fails closed without a database', async () => {
      const service = new AuthorizationService(undefined);
      await expect(service.assertMembership('org-1', 'u-1')).resolves.toBe(false);
      await expect(service.resolveMemberRole('org-1', 'u-1')).resolves.toBeUndefined();
    });

    it('resolves the effective member role', async () => {
      prisma.member.findUnique.mockResolvedValue({ role: 'MANAGER' });
      const service = new AuthorizationService(prisma as never);
      await expect(service.resolveMemberRole('org-1', 'u-1')).resolves.toBe('MANAGER');
    });
  });
});
