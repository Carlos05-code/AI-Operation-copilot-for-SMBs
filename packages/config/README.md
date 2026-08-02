# Config (`packages/config`)

> Runtime configuration & validation for the workspace.

Central location for runtime configuration schemas and validation referenced by the
[DevOps Specification](../../../../docs/specifications/DEVOPS_SPEC.md) and
[ADR-0013: Redis cache](../../../../docs/architecture/adrs/ADR-0013-redis.md).

- Feature flags: declared here, toggled per environment.
- `@nestjs/config` schema validated from `packages/config`.
- AI prompt catalog: `packages/config/prompts`, versioned.
