# Backend — Source

> NestJS application source. This directory is intentionally empty.

Implementation will follow the
[Backend Specification](../../../../docs/specifications/BACKEND_SPEC.md),
a Clean Architecture modular monolith:

```
apps/backend/src/
├── app.module.ts                 # root wiring
├── modules/                      # per-feature modules (auth, sales, ai, …)
├── shared/                       # config, logger, telemetry, errors, events, queues
└── main.ts                       # bootstrap, lifecycle, OpenAPI
```

Workspace root: see [Backend design](../../../../docs/specifications/BACKEND_SPEC.md).