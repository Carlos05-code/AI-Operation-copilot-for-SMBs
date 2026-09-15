# Docker

Container definitions for the platform.

| File                | Purpose                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile.api`    | NestJS backend image (multi-stage, `node:20.20.2-alpine`) — shipped                                                                                                                                                  |
| `Dockerfile.worker` | BullMQ worker image — not yet built; there's no separate worker bootstrap entrypoint for it to run (every `@Processor` still registers in-process on the API's `main.ts`), see `infrastructure/kubernetes/README.md` |
| `Dockerfile.mobile` | Flutter build image (debug/release artifact) — not yet built                                                                                                                                                         |

Root `docker-compose.yml` orchestrates all development services (see the repo root README). Keycloak
auto-imports the `smb-copilot` realm from `infrastructure/kubernetes/base/keycloak/realm.json` on
first boot (IDP config as code, ADR-0008) — moved there from `infrastructure/keycloak/` so
Kustomize's `configMapGenerator` can reference the same file without reaching outside its own
directory. Production images are pushed to GHCR by `.github/workflows/release.yml` on a `v*` tag and
referenced by `infrastructure/kubernetes` through that registry.

## Best practices applied

- Multi-stage build (`deps` → `build` → `prod-deps` → `runtime`); runtime is `node:20.20.2-alpine`.
- Pinned base tag (exact patch version, not just `20-alpine`).
- No secrets baked into image layers — env is injected at deploy time (Kubernetes
  `ConfigMap`/`Secret`).
- Non-root (`USER node`) in the runtime stage.
