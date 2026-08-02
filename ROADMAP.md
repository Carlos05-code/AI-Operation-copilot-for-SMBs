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

- [ ] Identity foundation: Keycloak + OpenID Connect + JWT
- [x] NestJS API skeleton (health, auth, logging, OpenAPI)
- [x] PostgreSQL schema (organizations, roles, customers, products, inventory, sales)
- [x] Prisma schema, migrations, and seed data
- [ ] RabbitMQ + BullMQ infrastructure for events and jobs
- [ ] Object storage integration (MinIO) with pre-signed uploads
- [x] Multi-tenant authorization framework (organization → role → member)
- [x] Unified error contract, correlation IDs, and tracing

**Version: 0.1.0**

---

## Phase 2 — AI pipeline: ingestion & integrations

**Goal**: bring organizational data into a single knowledge platform.

- [ ] Ingestion pipelines: documents (PDF → OCR → clean text)
- [ ] Email ingestion (IMAP) and WhatsApp parsing
- [ ] Knowledge base surface + organization-scoped access control
- [ ] Embeddings (BGE-M3, fallback OpenAI) and chunking service
- [ ] Knowledge graph (Neo4j): documents, entities, people, policies
- [ ] Hybrid search (vector + full-text via OpenSearch)
- [ ] AI chat and document Q&A with citations and confidence scoring

**Version: 0.2.0**

---

## Phase 3 — Operations hub

**Goal**: proactive operations for the daily business.

- [ ] Executive dashboard (revenue, AR, tasks, alerts)
- [ ] AI task planning (context-aware priorities, dependencies, deadlines)
- [ ] Invoice generation and recurring invoicing
- [ ] Inventory tracking with reorder alerts
- [ ] Appointment scheduling
- [ ] Purchase recommendations
- [ ] Notifications (in-app, WhatsApp, email)

**Version: 0.3.0**

---

## Phase 4 — Intelligence & execution

**Goal**: decision support and automatic workflow execution.

- [ ] Customer conversation summaries
- [ ] Sales forecasting (trend + seasonality on aggregated data)
- [ ] Purchase recommendations v2 (demand-aware)
- [ ] Low-risk task auto-completion with human-in-the-loop
- [ ] Visual workflow builder (rules engine) — stretch
- [ ] Executive insights briefings

**Version: 0.4.0**

---

## Phase 5 — Scale & harden

**Goal**: production posture at scale.

- [ ] Kubernetes deployment with Horizontal Pod Autoscaling (HPA)
- [ ] OpenTelemetry ingestion (traces, metrics, logs) unified
- [ ] Load and resilience testing (k6)
- [ ] Backup and disaster-recovery runbooks
- [ ] Large-document-volume benchmarks (200 k+ documents)
- [ ] Multi-region readiness documented in an ADR

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
