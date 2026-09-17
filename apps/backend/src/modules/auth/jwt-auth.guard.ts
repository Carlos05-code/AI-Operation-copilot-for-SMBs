/**
 * JwtAuthGuard: verifies RS256 bearer tokens against the Keycloak JWKS
 * endpoint (SECURITY_SPEC §3).
 *
 * Validation: signature via JWKS, `alg` must be RS256, and `iss`/`aud`/
 * `exp`/`nbf` are enforced by `jose`. When auth is not configured
 * (`AUTH_JWKS_URL` missing) the guard fails closed with 401 so no endpoint
 * accidentally runs unauthenticated.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { JWTVerifyGetKey, JWTPayload } from 'jose';
import { jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import { AuthClaims, AuthContext, AuthenticatedRequest } from './auth.types';

export const AUTH_JWKS = 'AUTH_JWKS';

/** Shape of a JWKS getter (createRemoteJWKSet / createLocalJWKSet). */
export type JwksGetter = JWTVerifyGetKey;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(AUTH_JWKS)
    private readonly jwks?: JwksGetter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.jwks) {
      throw new UnauthorizedException('Authentication is not configured (AUTH_JWKS_URL)');
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['RS256'],
        issuer: process.env.AUTH_ISSUER ?? undefined,
        audience: process.env.AUTH_AUDIENCE ?? undefined,
      });
      request.user = this.toAuthContext(payload);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractBearerToken(header: string | string[] | undefined): string | undefined {
    const value = Array.isArray(header) ? header[0] : header;
    const match = value?.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
  }

  private toAuthContext(payload: JWTPayload): AuthContext {
    const claims = payload as JWTPayload & AuthClaims;
    const role = (claims['org.role'] ?? claims.role) as Role | undefined;
    return {
      userId: claims.sub ?? '',
      organizationId: claims.org_id,
      role,
      email: claims.email,
    };
  }
}
