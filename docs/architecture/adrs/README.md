# Architecture Decision Records

An Architecture Decision Record (ADR) captures a significant architectural decision along with its
context and consequences. See the [ADR template](./ADR-template.md) for the required format.

## Why ADRs

- Decisions become explicit rather than implicit carve-outs.
- New teammates onboard faster ("why is the stack this way?").
- Reviewers can challenge the reasoning, not just the code.
- Changes to decisions are themselves recorded as new ADRs.

## Active decisions

| #                                       | Title                              | Status   | Adopted    |
| --------------------------------------- | ---------------------------------- | -------- | ---------- |
| [ADR-0001](./ADR-0001-monorepo.md)      | Monorepo with Turborepo + pnpm     | Accepted | 2026-08-02 |
| [ADR-0002](./ADR-0002-flutter.md)       | Flutter as single client framework | Accepted | 2026-08-02 |
| [ADR-0003](./ADR-0003-nestjs.md)        | NestJS backend framework           | Accepted | 2026-08-02 |
| [ADR-0004](./ADR-0004-postgresql.md)    | PostgreSQL as system of record     | Accepted | 2026-08-02 |
| [ADR-0005](./ADR-0005-neo4j.md)         | Neo4j for knowledge graph          | Accepted | 2026-08-02 |
| [ADR-0006](./ADR-0006-qdrant.md)        | Qdrant as vector database          | Accepted | 2026-08-02 |
| [ADR-0007](./ADR-0007-rabbitmq.md)      | RabbitMQ for event-driven delivery | Accepted | 2026-08-02 |
| [ADR-0008](./ADR-0008-keycloak.md)      | Keycloak as identity provider      | Accepted | 2026-08-02 |
| [ADR-0009](./ADR-0009-docker.md)        | Docker containers throughout       | Accepted | 2026-08-02 |
| [ADR-0010](./ADR-0010-kubernetes.md)    | Kubernetes for orchestration       | Accepted | 2026-08-02 |
| [ADR-0011](./ADR-0011-opentelemetry.md) | OpenTelemetry for observability    | Accepted | 2026-08-02 |
| [ADR-0012](./ADR-0012-opensearch.md)    | OpenSearch for full-text search    | Accepted | 2026-08-02 |
| [ADR-0013](./ADR-0013-redis.md)         | Redis for cache & queues           | Accepted | 2026-08-02 |

## Superseded / proposed

_None yet._

## How to propose a new ADR

1. Copy `ADR-template.md` → `ADR-00nn-slug.md`.
2. Fill Context, Decision, Options, and ordering pros/cons against choices.
3. Mark status **Proposed**, link it in this list.
4. Open a PR; merge after the team review in Code Review.

## Format

Each ADR contains:

- **Status** — Proposed / Accepted / Accepted+ / Superseded / Rejected / Deprecated
- **Context** — the forces at play
- **Decision** — what was decided, statements
- **Alternatives** — options considered
- **Pros / Cons** — of the decision
- **Consequences** — what this decision implies for the system
- **References** — links to code/docs that implement it
