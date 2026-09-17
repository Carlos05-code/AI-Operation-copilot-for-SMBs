# Load & resilience tests (k6)

Three scenarios (TESTING_SPEC §6), one shared request mix (`lib/workload.ts`):

| Script     | Shape                                      | Purpose                                                                                     |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `smoke.ts` | 5 VUs · 1 min                              | Fast "did we break something obvious" gate                                                  |
| `soak.ts`  | ramp to 200 VUs · hold ~26 min · ramp down | Sustained load — connection/memory/queue-depth drift                                        |
| `spike.ts` | ramp to 1,000 VUs in 30s · hold 1 min      | Burst resilience — does the HPA (`api-hpa.yaml`) react in time and recover, or cascade-fail |

Pass bar for smoke/soak (`lib/thresholds.ts`): **p95 request duration < 800ms, error rate < 1%** —
the same numbers as the production SLO alerts (DEVOPS_SPEC §8,
`infrastructure/monitoring/prometheus/alerting-rules.yml`). Spike uses a looser bar (p95 < 2s, error
rate < 5%) since briefly degrading — not cascading — is the actual thing being tested there.

## Prerequisites

- [k6](https://k6.io) v1.0+ (native TypeScript execution — no build step). Verified against
  `k6 v2.2.0`.
- A running target: local (`docker compose up -d` + `pnpm --filter @smb-copilot/backend start:dev`,
  seeded via `pnpm --filter @smb-copilot/backend db:seed`) or a real staging/production URL.
- The seeded demo org/users (`apps/backend/prisma/seed.ts`) — every script logs in as one of the
  three demo users via Keycloak's password grant (`lib/auth.ts`); there's no way to load-test
  against a database that hasn't been seeded.

## Running

```sh
# Local stack, defaults match docker-compose.yml / .env.example
k6 run tests/load/smoke.ts

# Any other target
k6 run \
  -e BASE_URL=https://api-staging.smb-copilot.example.com \
  -e KEYCLOAK_URL=https://auth-staging.smb-copilot.example.com \
  -e DEMO_PASSWORD=<real value, never the seeded default in a real environment> \
  tests/load/soak.ts
```

All `-e` flags are optional and documented in `lib/config.ts`; every one defaults to the local
docker-compose value. **Never point `soak.ts`/`spike.ts` at production against real customer data**
— `createInvoice` in `lib/workload.ts` writes real rows.

## Results

k6 prints a summary to stdout; pass `--out json=tests/load/results/<run>.json` to keep a trend file
(the `results/` directory is gitignored — these are local/CI artifacts, not committed data).

## CI status

Wired into `.github/workflows/release.yml`'s `load-test` job, gating `release` (`needs: load-test`)
on every `v*` tag push, matching `TESTING_SPEC.md`'s CI diagram (`tag.v --> LOAD[k6 soak]`). The job
boots the full stack (Postgres, Redis, RabbitMQ, Keycloak, OpenSearch, Qdrant, Neo4j, the built API)
as GitHub Actions `services:` containers with the same defaults docker-compose.yml uses, migrates +
seeds the database, imports the Keycloak realm via the Admin REST API (service containers start
before `actions/checkout`, so `--import-realm`'s file-based approach can't be used in CI), then runs
`k6 run tests/load/soak.ts` for real — verified end-to-end: a real 30-minute, 200-VU run passes at
100% (`checks_succeeded: 168167 out of 168167`, `http_req_failed: 0.00%`, p95 7.69ms). Also runnable
on demand via `workflow_dispatch` against any branch, without cutting a tag — `release` itself stays
gated to an actual tag push regardless of how the workflow was triggered.

Building this surfaced (and fixed) several real, previously-latent bugs nothing had ever exercised
end-to-end: three separate `realm.json` schema mismatches against Keycloak 24's actual
`RealmRepresentation`/role-claim conventions, a missing `AUTH_JWKS` export from `AuthModule`
(silently made every guarded request 401 outside `AuthModule`'s own container), a real concurrency
bug in invoice-number allocation (fixed with an atomic raw-SQL counter,
`apps/backend/prisma/schema.prisma`'s `InvoiceNumberCounter`), and a seed-data/counter mismatch. See
`CHANGELOG.md` for the full list.
