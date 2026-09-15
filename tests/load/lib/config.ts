/**
 * Target environment, read once per VU. Defaults match `docker-compose.yml` /
 * `.env.example` so `k6 run tests/load/smoke.ts` works against an unmodified local
 * stack with zero flags — override via `-e` for staging/production (TESTING_SPEC §6).
 */
export interface LoadTestConfig {
  baseUrl: string;
  keycloakUrl: string;
  realm: string;
  clientId: string;
  orgId: string;
  users: { username: string; password: string }[];
  customerId: string;
}

function env(name: string, fallback: string): string {
  // k6 exposes `-e KEY=value` flags on `__ENV`, not `process.env`.
  return __ENV[name] ?? fallback;
}

export function loadConfig(): LoadTestConfig {
  return {
    baseUrl: env('BASE_URL', 'http://localhost:3000'),
    keycloakUrl: env('KEYCLOAK_URL', 'http://localhost:8080'),
    realm: env('KEYCLOAK_REALM', 'smb-copilot'),
    clientId: env('KEYCLOAK_CLIENT_ID', 'smb-copilot-ui'),
    // Seeded demo org (apps/backend/prisma/seed.ts) — pinned to match the `org_id`
    // attribute baked into every demo user in
    // infrastructure/kubernetes/base/keycloak/realm.json.
    orgId: env('ORG_ID', '8841a049-893c-4c2b-b342-456c7074b25d'),
    // All three demo users share one password (`realm.json`); mixing them spreads
    // load across distinct JWTs/roles instead of every VU looking identical.
    users: [
      { username: 'owner@acme-demo.local', password: env('DEMO_PASSWORD', 'changeme') },
      { username: 'manager@acme-demo.local', password: env('DEMO_PASSWORD', 'changeme') },
      { username: 'viewer@acme-demo.local', password: env('DEMO_PASSWORD', 'changeme') },
    ],
    customerId: env('CUSTOMER_ID', '00000000-0000-0000-0000-00000000c001'),
  };
}
