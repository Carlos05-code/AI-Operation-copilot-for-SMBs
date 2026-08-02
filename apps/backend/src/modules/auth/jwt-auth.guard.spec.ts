import { UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { JwtAuthGuard } from './jwt-auth.guard';

interface ExecutionContextLike {
  switchToHttp(): { getRequest(): Record<string, unknown> };
}

function makeContext(header: string | undefined): ExecutionContextLike {
  const request: Record<string, unknown> = { headers: { authorization: header } };
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

describe('JwtAuthGuard', () => {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    ({ privateKey, publicKey } = await generateKeyPair('RS256'));
    const jwk = await exportJWK(publicKey);
    jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', use: 'sig' }] });
  });

  function sign(
    payload: Record<string, unknown>,
    opts: { issuer?: string; audience?: string; exp?: number } = {},
  ): Promise<string> {
    const builder = new SignJWT(payload).setProtectedHeader({ alg: 'RS256' });
    if (opts.issuer) builder.setIssuer(opts.issuer);
    if (opts.audience) builder.setAudience(opts.audience);
    if (opts.exp) builder.setExpirationTime(opts.exp);
    return builder.sign(privateKey);
  }

  it('fails closed when no JWKS is configured', async () => {
    const guard = new JwtAuthGuard(undefined);
    await expect(guard.canActivate(makeContext('Bearer abc') as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects missing bearer tokens', async () => {
    const guard = new JwtAuthGuard(jwks);
    await expect(guard.canActivate(makeContext(undefined) as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(makeContext('Basic abc') as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a valid RS256 token and attaches the auth context', async () => {
    const guard = new JwtAuthGuard(jwks);
    const token = await sign(
      { sub: 'user-1', org_id: 'org-1', 'org.role': 'ADMIN', email: 'a@example.com' },
      { issuer: 'https://id.example/issuer', audience: 'smb-copilot-api' },
    );
    const context = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    const request = context.switchToHttp().getRequest() as Record<string, unknown> & {
      user: { userId: string; organizationId?: string; role?: string; email?: string };
    };
    expect(request.user).toEqual({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
      email: 'a@example.com',
    });
  });

  it('rejects expired tokens', async () => {
    const guard = new JwtAuthGuard(jwks);
    const token = await sign({ sub: 'user-1' }, { exp: -1 });
    await expect(guard.canActivate(makeContext(`Bearer ${token}`) as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects tokens signed with a foreign key', async () => {
    const guard = new JwtAuthGuard(jwks);
    const { privateKey: other } = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(other);
    await expect(guard.canActivate(makeContext(`Bearer ${token}`) as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects tokens when issuer/audience do not match configuration', async () => {
    const previousIssuer = process.env.AUTH_ISSUER;
    const previousAudience = process.env.AUTH_AUDIENCE;
    process.env.AUTH_ISSUER = 'https://id.example/issuer';
    process.env.AUTH_AUDIENCE = 'smb-copilot-api';
    try {
      const guard = new JwtAuthGuard(jwks);
      const token = await sign(
        { sub: 'user-1' },
        { issuer: 'https://evil.example', audience: 'other-client' },
      );
      await expect(
        guard.canActivate(makeContext(`Bearer ${token}`) as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      if (previousIssuer === undefined) delete process.env.AUTH_ISSUER;
      else process.env.AUTH_ISSUER = previousIssuer;
      if (previousAudience === undefined) delete process.env.AUTH_AUDIENCE;
      else process.env.AUTH_AUDIENCE = previousAudience;
    }
  });

  it('verifies the returned signature with jose', async () => {
    const token = await sign({ sub: 'user-1' });
    const { payload } = await jwtVerify(token, jwks as never);
    expect(payload.sub).toBe('user-1');
  });
});
