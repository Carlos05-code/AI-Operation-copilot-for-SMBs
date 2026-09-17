/**
 * Per-VU token cache. The backend has no login endpoint of its own — auth is
 * entirely delegated to Keycloak (JwtAuthGuard verifies bearer JWTs against its
 * JWKS) — so getting a usable token means a real OAuth2 Resource Owner Password
 * Credentials grant against Keycloak's own token endpoint, using the
 * `smb-copilot-ui` client (public, `directAccessGrantsEnabled: true` in
 * infrastructure/kubernetes/base/keycloak/realm.json).
 *
 * Module-scope state is per-VU in k6 (each VU runs its own JS runtime instance),
 * so caching the token here — rather than fetching it once in `setup()` and
 * sharing it — means every VU logs in independently and refreshes on its own
 * schedule. That avoids a refresh-token-rotation race that would hit if many VUs
 * shared one initial refresh token (Keycloak's default rotation invalidates a
 * refresh token on reuse), at the cost of every VU doing its own login call —
 * which, for a spike test ramping to 1k VUs, is itself a real thing worth
 * measuring: how does Keycloak's token endpoint hold up under a login stampede.
 */
import http from 'k6/http';
import { check } from 'k6';
import { loadConfig, type LoadTestUser } from './config.ts';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

let cachedToken: string | null = null;
let cachedUser: LoadTestUser | null = null;
let expiresAtMs = 0;
// Re-login this long before the token's real expiry, so a slow request never
// gets caught starting out with an already-expired bearer token mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export function getToken(): string {
  const now = Date.now();
  if (cachedToken !== null && now < expiresAtMs) {
    return cachedToken;
  }

  const config = loadConfig();
  const user = config.users[Math.floor(Math.random() * config.users.length)];
  const tokenUrl = `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/token`;

  const res = http.post(
    tokenUrl,
    {
      grant_type: 'password',
      client_id: config.clientId,
      username: user.username,
      password: user.password,
    },
    { tags: { name: 'KeycloakLogin' } },
  );

  const ok = check(res, { 'login succeeded': (r) => r.status === 200 });
  if (!ok) {
    throw new Error(`Keycloak login failed for ${user.username}: HTTP ${res.status} ${res.body}`);
  }

  const body = res.json() as unknown as TokenResponse;
  cachedToken = body.access_token;
  cachedUser = user;
  expiresAtMs = now + body.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS;
  return cachedToken;
}

/**
 * The role backing the currently cached token — same VU, same role, until the
 * next re-login (see the module comment above). Callers use this to skip
 * write actions a VIEWER genuinely can't do (API_SPEC §6), not to predict
 * every guard's exact decision.
 */
export function getCurrentRole(): LoadTestUser['role'] {
  getToken(); // ensures cachedUser is populated (logs in on first call/after expiry)
  return (cachedUser as LoadTestUser).role;
}

export function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}
