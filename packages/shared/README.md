# Shared (`packages/shared`)

> Shared TypeScript contracts used by the backend and documented API.

Holds canonical type contracts referenced by [API_SPEC](../../../../docs/specifications/API_SPEC.md)
and [ADR-0001: Monorepo](../../../../docs/architecture/adrs/ADR-0001-monorepo.md).

- Contract changes here fan out to all consumers — review with care.
- Backend reuses these contracts for DTOs and event schemas.
