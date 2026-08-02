# Backend — Source

> NestJS application source. Implemented per the
> [Backend Specification](../../../../docs/specifications/BACKEND_SPEC.md), a Clean Architecture
> modular monolith:

```
apps/backend/src/
├── app.module.ts                 # root wiring (config, core, feature modules)
├── main.ts                       # bootstrap, validation pipe, OpenAPI
├── modules/                      # per-feature modules
│   ├── database/                 # PrismaService (PostgreSQL access)
│   ├── health/                   # readiness + liveness probes
│   └── openapi/                  # serves the generated OpenAPI 3.1 document
└── shared/                       # config, logger, errors, context, envelope
    ├── config/                   # environment validation (class-validator)
    ├── context/                  # request id middleware + AsyncLocalStorage
    ├── envelope/                 # success envelope interceptor
    ├── errors/                   # error contract + global exception filter
    ├── logger/                   # Pino structured logging
    └── openapi/                  # OpenAPI document builder
```

Feature modules will grow into `domain | application | infrastructure` layers as business features
land in later phases.

Database schema lives in `apps/backend/prisma/` (Prisma is the single source of truth for the
PostgreSQL schema, DATABASE_SPEC §9): `schema.prisma`, versioned migrations, and an idempotent
`seed.ts` (run with `pnpm db:seed`).

Workspace root: see [Backend design](../../../../docs/specifications/BACKEND_SPEC.md).
