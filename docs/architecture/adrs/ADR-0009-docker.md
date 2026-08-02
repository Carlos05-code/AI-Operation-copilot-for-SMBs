# ADR-0009: Docker as the standard container runtime

- Status: Accepted
- Date: 2026-08-02
- Owner: Platform
- Deciders: Infrastructure

## Context

Services (API, workers, databases) and the AI toolchain need reproducible, portable execution
everywhere: dev laptop, CI, and production. Options: bare metal, virtual machines, Docker
containers, distroless, Podman.

## Decision

Use **Docker** for all services; docker-compose.yml at repo root orchestractes the local
environment.

- Images: multi-stage builds, minimal base images, pinned tags.
- Compose for dev; Kubernetes (ADR-0010) for prod scheduling.
- Secrets never baked into images.

## Alternatives

| Option               | Trade-off                                                       |
| -------------------- | --------------------------------------------------------------- |
| VMs                  | Heavy, less reproducible per-service                            |
| Bare metal + systemd | Ops-heavy, environment drift                                    |
| Podman               | Compatible; team value still requires remote/CI; Docker default |

## Pros

- Consistency between dev, CI, prod; rapid onboarding with `docker compose up`.
- Huge ecosystem; each service from official images.
- Composability with K8s (K-r resource definitions).

## Cons

- Extra layer (daemon, images size).
- Security hygiene required (image scanning, non-root, pinned tags).

## Consequences

- Root `docker-compose.yml` describes all dev services.
- `infrastructure/docker/` holds bespoke images.
- CI builds + scans images for every release.

## References

- [docker-compose.yml](../../docker-compose.yml)
- [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md)
