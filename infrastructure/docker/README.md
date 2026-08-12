# Docker

Container definitions for the platform.

| File                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `Dockerfile.api`    | NestJS backend image (multi-stage, node 20-slim) |
| `Dockerfile.worker` | BullMQ worker image (shares base with API)       |
| `Dockerfile.mobile` | Flutter build image (debug/release artifact)     |

Root `docker-compose.yml` orchestrates all development services (see the repo root README). Keycloak
auto-imports the `smb-copilot` realm from `../keycloak/realm.json` on first boot (IDP config as
code, ADR-0008). Production images are referenced by `infrastructure/kubernetes` through the GHCR
registry.

## Best practices applied

- Multi-stage builds; runtime is `node:20-alpine` + `nonroot`.
- Pinned base tag + digest.
- No secrets baked into image layers.
- Non-root user in runtime stage.
