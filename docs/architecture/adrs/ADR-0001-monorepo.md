# ADR-0001: Monorepo with Turborepo + pnpm

- Status: Accepted
- Date: 2026-08-02
- Owner: Carlos05-code
- Deciders: Platform Team

## Context

The platform consists of a Flutter client, a NestJS backend, shared packages
(contracts, design tokens, config) and infrastructure-as-code. Early on we must
decide between multiple small repositories vs one monorepo. Key forces:

- Code sharing (DTOs, types, config) should be near-instant.
- Consistency of tooling and CI.
- Independent release cadence would eventually help, but simple start beats it.
- Repository size manageable (< a few thousand files projected).

## Decision

Use a **single monorepo** managed by **Turborepo** with **pnpm workspaces**.

- Todos of the repo: `apps/*` (mobile, backend) and `packages/*` (shared, ui, config).
- pnpm workspace + lockfile; Turborepo for build caching and parallelization.
- Framework-owned config at root; each package owns its consumer-specific config.

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| Polyrepo (per app) | Hard, versioned sharing; duplicated CI; slower cross-cutting change |
| Single repo no cache | Simple but rebuilds everything; slower |

## Pros

- Atomic cross-cutting changes (API spec, shared DTO, UI token change).
- Single lockfile, single PR, easy review adjacency.
- Cacheable across CI and local.

## Cons

- Larger checkout.
- Tool migration for package borders must be clear.

## Consequences

- All packages built through Turborepo tasks (`build`, `lint`, `test`, `typecheck`).
- Contract changes in `packages/shared` fan out to all consumers.
- Splitting a service later is still possible (see ADR-0003 modularity).

## References

- [`turbo.json`](../../turbo.json)
- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)