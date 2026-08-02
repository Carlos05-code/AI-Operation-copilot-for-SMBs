/**
 * Auth context shapes (SECURITY_SPEC §3/§4).
 *
 * Tokens carry `sub` (user), `org_id` (tenant) and the org role claim
 * (`org.role`, with `role` accepted as a fallback). The guards map raw JWT
 * claims to a typed `AuthContext` attached to the request as `request.user`.
 */
import type { Role } from '@prisma/client';

export interface AuthContext {
  userId: string;
  organizationId?: string;
  role?: Role;
  email?: string;
}

/** Raw JWT claims we consume. */
export interface AuthClaims {
  sub?: string;
  org_id?: string;
  'org.role'?: string;
  role?: string;
  email?: string;
}

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  AGENT: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

/** Convenience type to keep `request.user` access explicit. */
export interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthContext;
}
