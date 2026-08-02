/**
 * AuthorizationService: RBAC role hierarchy + tenancy membership checks
 * (SECURITY_SPEC §4).
 *
 * Roles are hierarchical: OWNER > ADMIN > MANAGER > AGENT > VIEWER. A member
 * holding a higher-ranked role satisfies any requirement at or below it.
 * Guards fail closed: when the database is unavailable or the membership
 * cannot be proven, the request is denied.
 */
import { Injectable, Optional } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ROLE_RANK } from './auth.types';

@Injectable()
export class AuthorizationService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Rank of a role; unknown roles rank below VIEWER (fail closed). */
  roleRank(role: string | undefined): number {
    return typeof role === 'string' ? (ROLE_RANK[role as Role] ?? -1) : -1;
  }

  /** True when `userRole` satisfies `required` (same or higher rank). */
  hasRole(userRole: string | undefined, required: string): boolean {
    return this.roleRank(userRole) >= this.roleRank(required);
  }

  /** True when `userRole` satisfies at least one of the required roles. */
  hasAnyRole(userRole: string | undefined, required: string[]): boolean {
    return required.some((r) => this.hasRole(userRole, r));
  }

  /** Verifies the user is an active member of the organization. */
  async assertMembership(organizationId: string, userId: string): Promise<boolean> {
    if (!this.prisma) return false;
    const member = await this.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    return member !== null;
  }

  /** Resolves the member's effective role, or undefined when not a member. */
  async resolveMemberRole(organizationId: string, userId: string): Promise<Role | undefined> {
    if (!this.prisma) return undefined;
    const member = await this.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    return member?.role;
  }
}
