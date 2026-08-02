/**
 * TenancyGuard: scopes every authenticated request to the tenant encoded in
 * the token's `org_id` claim (API_SPEC §6, SECURITY_SPEC §3) and verifies the
 * user is an active member of that organization. Must run after JwtAuthGuard.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from './auth.types';
import { AuthorizationService } from './authorization.service';

@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user?.organizationId || !user.userId) {
      throw new ForbiddenException('Tenant context missing from token');
    }
    const isMember = await this.authorization.assertMembership(user.organizationId, user.userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this organization');
    }
    return true;
  }
}
