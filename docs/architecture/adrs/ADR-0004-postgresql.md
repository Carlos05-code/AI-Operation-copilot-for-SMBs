# ADR-0004: PostgreSQL as system of record

- Status: Accepted
- Date: 2026-08-02
- Owner: Data Team
- Deciders: Backend Team

## Context

The platform needs a strong relational store for transactional business data: organizations, users,
products, inventory, sales, invoices, tasks, audit logs. Requirements: ACID, multi-tenant isolation,
rich types, wide ecosystem, mature tooling in Prisma, and operational simplicity. Options:
PostgreSQL, MySQL, SQL Server, DynamoDB (NewSQL renaming), CockroachDB.

## Decision

Use **PostgreSQL** as the primary relational database, accessed via **Prisma** ORM.

- Multi-tenant: single database instance with row-level `org_id` + RBAC (see SECURITY).
- Data in third normalized form with migrations as code (Prisma).

## Alternatives

| Option      | Trade-off                                                |
| ----------- | -------------------------------------------------------- |
| MySQL       | Close; slightly weaker advanced features (arrays, JSONB) |
| SQL Server  | Strong, but licensing + ops focus cross team             |
| DynamoDB    | Not ACID-friendly for joins; schema separates harder     |
| CockroachDB | Distributed PG, overkill at this stage                   |

## Pros

- Robust ACID + relational power for financial & invoicing integrity.
- Excellent Prisma support; JSONB for adaptable payloads.
- Mature tooling (backups, replication, monitoring) & community.

## Cons

- Not the best fit for relationship-graph queries (that's Neo4j; ADR-0005).
- Scaling beyond one Postgres requires read replicas/sharding later.

## Consequences

- Schema lives in Prisma (`apps/backend/prisma/schema.prisma`); migrations are code.
- Row-level tenancy + organization context enforced in application layer.
- Read models derived async for search/index (see Event-Driven).

## References

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
- [`apps/backend/prisma/`](../../apps/backend/prisma/)
