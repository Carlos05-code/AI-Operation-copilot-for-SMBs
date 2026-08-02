/**
 * AuthModule: global module wiring the multi-tenant authorization framework
 * (SECURITY_SPEC §3/§4).
 *
 * Provides:
 * - `AUTH_JWKS` — JWKS getter built from `AUTH_JWKS_URL` (Keycloak); absent
 *   when auth is not configured, causing JwtAuthGuard to fail closed.
 * - `JwtAuthGuard` / `RolesGuard` / `TenancyGuard` — usable via @UseGuards.
 * - `AuthorizationService` — RBAC hierarchy + membership lookups.
 */
import { Global, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { AuthorizationService } from './authorization.service';
import { AUTH_JWKS } from './jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TenancyGuard } from './tenancy.guard';

@Global()
@Module({
  providers: [
    AuthorizationService,
    JwtAuthGuard,
    RolesGuard,
    TenancyGuard,
    {
      provide: AUTH_JWKS,
      useFactory: () => {
        const url = process.env.AUTH_JWKS_URL;
        if (!url) return undefined;
        return createRemoteJWKSet(new URL(url));
      },
    },
  ],
  exports: [AuthorizationService, JwtAuthGuard, RolesGuard, TenancyGuard],
})
export class AuthModule {}
