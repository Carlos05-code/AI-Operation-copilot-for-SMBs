# Roadmap

The delivery plan is organized into phases. Phases are feature-focused and align end-to-end value
with architectural maturity. Dates are indicative; priorities are rebalanced at each sprint review.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundation

> Repository-level infrastructure and documentation-first baseline.

- [x] Repository structure (monorepo, apps, docs, infrastructure)
- [x] Engineering documentation and spec/ADR suite under `docs/`
- [x] Tooling (pnpm workspaces, Turborepo, ESLint, Prettier, commitlint)
- [x] Issue templates and CI/CD workflow baseline
- [x] Local infrastructure baseline (Docker Compose)
- [x] Design system foundation (`packages/ui`, `DESIGN_SYSTEM.md`)

**Exit criteria**

- CI is green on PRs (lint, build, test, docs).
- `docker compose up` brings up the full local stack.
- A developer can run the API and the Flutter app end-to-end.

---

## Phase 1 — Platform foundations

**Goal**: identity, accounts, and the API skeleton.

- [x] Identity foundation: Keycloak + OpenID Connect + JWT
- [x] NestJS API skeleton (health, auth, logging, OpenAPI)
- [x] PostgreSQL schema (organizations, roles, customers, products, inventory, sales)
- [x] Prisma schema, migrations, and seed data
- [x] RabbitMQ + BullMQ infrastructure for events and jobs
- [x] Object storage integration (MinIO) with pre-signed uploads
- [x] Multi-tenant authorization framework (organization → role → member)
- [x] Unified error contract, correlation IDs, and tracing

**Version: 0.1.0**

---

## Phase 2 — AI pipeline: ingestion & integrations

**Goal**: bring organizational data into a single knowledge platform.

- [x] Ingestion pipelines: documents (PDF → OCR → clean text)
- [x] Channel connectors: WhatsApp / email / Slack inbound adapters
- [x] Knowledge base surface + organization-scoped access control
- [x] Embeddings (BGE-M3, fallback OpenAI) and chunking service
- [x] Knowledge graph (Neo4j): documents, entities, people, policies
- [x] Hybrid search (vector + full-text via OpenSearch)
- [x] AI chat and document Q&A with citations and confidence scoring
- [x] Conversation ingestion (messages schema + `conversation_{org}` embeddings)

**Version: 0.2.0**

---

## Phase 3 — Operations hub

**Goal**: proactive operations for the daily business.

- [x] Executive dashboard (revenue, AR, tasks, alerts)
- [x] AI task planning (context-aware priorities, dependencies, deadlines)
- [x] Invoice generation and recurring invoicing
- [x] Inventory tracking with reorder alerts
- [x] Appointment scheduling
- [x] Purchase recommendations
- [~] Notifications (in-app ✓, email ✓, WhatsApp ✓ via Twilio — real, Sandbox-tested, but wired and
  dormant until a caller opts a specific alert into `NotificationKind.WHATSAPP`; no delivery-status
  webhook yet)

**Version: 0.3.0**

---

## Phase 4 — Intelligence & execution

**Goal**: decision support and automatic workflow execution.

- [x] Customer conversation summaries
- [x] Sales forecasting (trend + seasonality on aggregated data)
- [x] Purchase recommendations v2 (demand-aware)
- [x] Low-risk task auto-completion with human-in-the-loop
- [x] Visual workflow builder (rules engine) — stretch (rules engine only; no visual canvas yet)
- [x] Executive insights briefings

**Version: 0.4.0**

---

## Phase 5 — Scale & harden

**Goal**: production posture at scale.

- [~] Kubernetes deployment with Horizontal Pod Autoscaling (HPA) — Kustomize base +
  staging/production overlays, `api` **and** `worker` Deployments each with their own HPA on
  CPU/memory (`apps/backend/src/main-worker.ts`, additional BullMQ consumer capacity alongside the
  API's own in-process processing). `worker` bootstraps `WorkerAppModule`, a fully clean split from
  `AppModule` — every feature module that used to bundle a controller with its workers is now an
  HTTP half + a worker half, so no `@Controller` is reachable from the worker's module tree at all
  (verified by running the compiled worker and checking its own boot log). Remaining gap: the
  in-cluster StatefulSets are staging-only, not a production-grade posture (see
  overlays/production/README.md)
- [x] OpenTelemetry ingestion (traces ✓, metrics ✓, logs correlated ✓, Loki log shipping ✓ — the
      API's own logs; the other containerized dependencies' logs aren't shipped anywhere, a
      separate, smaller gap noted in `infrastructure/monitoring/README.md`)
- [x] Load and resilience testing (k6) — smoke/soak/spike scripts (`tests/load/`), real Keycloak
      auth, SLO-matching thresholds, wired into CI (`.github/workflows/release.yml`'s `load-test`
      job gates every `v*` release tag) and verified end-to-end: a real 30-minute, 200-VU soak run
      passes at 100% (see `tests/load/README.md`). Building this surfaced and fixed several real,
      previously-unexercised bugs — Keycloak realm schema mismatches, a missing DI export, an
      invoice-numbering concurrency race — see `CHANGELOG.md`
- [~] Backup and disaster-recovery runbooks — nightly CronJobs for 5 of 6 stateful services
  (`infrastructure/kubernetes/base/backup/`), including OpenSearch's `repository-s3`-plugin snapshot
  into the off-cluster MinIO bucket
  (`infrastructure/kubernetes/base/infrastructure/opensearch.yaml`), PostgreSQL WAL archiving/PITR
  via `wal-g` (`infrastructure/kubernetes/base/infrastructure/postgres.yaml`), and a restore
  runbook, including a PITR procedure (`infrastructure/devops/incident.md`). Gaps: Neo4j's export
  path is unverified against a live cluster, both the OpenSearch S3 snapshot path and PostgreSQL WAL
  archiving/PITR are wired up but likewise unverified against a live cluster, and no restore
  (including the new PITR path) has been drilled end-to-end
- [~] Large-document-volume benchmarks (200 k+ documents) — corpus generator + bulk-ingest harness +
  report tooling shipped (`tests/benchmarks/large-corpus/`), verified end-to-end against a mock
  server; no live cluster available to actually run the 200k benchmark and record real numbers, so
  the README's capacity table is a computed estimate and its results template is still blank
- [x] Multi-region readiness documented in an ADR —
      [ADR-0014](docs/architecture/adrs/ADR-0014-multi-region.md): a phased, backup-restore-first
      decision (today's backup/DR work already covers cross-region disaster recovery; live
      cross-region replication is deferred, and named as blocked on Neo4j Community's lack of any
      clustering/replication until that's separately resolved)

**Version: 1.0.0**

---

## Version History

| Version | Milestone                   | Status  |
| ------- | --------------------------- | ------- |
| 0.1.0   | Platform foundations        | planned |
| 0.2.0   | AI pipeline & integrations  | planned |
| 0.3.0   | Operations hub              | planned |
| 0.4.0   | Intelligence & execution    | planned |
| 1.0.0   | Scale & harden (production) | planned |

## Guiding Principles

1. **Documentation before code** — each milestone ships with updated docs, diagrams, and ADRs in the
   same change.
2. **Vertical slices first** — a working end-to-end path reveals more than many horizontal layers.
3. **The operating bar**: exit criteria from `CONTRIBUTING.md` apply to every feature; no stubs, no
   placeholders.
4. **Operations and security are first-class** — never afterthoughts.
