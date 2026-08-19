# Backend Specification

> NestJS modules · repositories · services · DTOs · events · workers · config

## 1. Overview

The backend is a **NestJS** application (TypeScript) implemented as a clean Architecture modular
monolith. See [ARCHITECTURE_SPEC](./ARCHITECTURE_SPEC.md) for layering; this spec covers the
operational contract within `apps/backend`.

## 2. Module Layout

```
apps/backend/src/
├── app.module.ts                 # root wiring
├── modules/
│   ├── tenant/                   # org context, slug, tenancy
│   ├── auth/                     # Keycloak/OIDC adapter, guards
│   ├── customers/                # domain module (CRUD, channels)
│   ├── products/
│   ├── inventory/
│   ├── sales/
│   ├── invoicing/
│   ├── tasks/
│   ├── documents/
│   ├── knowledge/
│   ├── search/
│   ├── ai/                       # ai gateway, prompts, RAG ports
│   ├── notifications/
│   └── analytics/
├── shared/
│   ├── config/                   # @nestjs/config schema (see packages/config)
│   ├── logger/                   # pino
│   ├── telemetry/                # OpenTelemetry
│   ├── errors/                   # typed exceptions -> ApiError contract
│   ├── tenancy/                  # scoped context
│   ├── events/                   # outbox + RabbitMQ bus
│   └── queues/                   # BullMQ registration
└── main.ts                       # bootstrap, lifecycle, OpenAPI
```

## 3. Layering rules (module)

Each feature module must keep:

- `domain/` — pure entities/rules, no Nest imports.
- `application/` — use-cases (services), ports (interfaces), DTOs.
- `infrastructure/` — controllers/guards, adapters (Prisma, HTTP), queued jobs.
- DI wiring only in the module `*.module.ts`.

## 4. Repositories

- **Repository interface** lives in `application/ports`; Prisma implementation in `infrastructure`.
- Always tenancy-scoped: every repository method takes `TenantContext` and joins org filtering
  (`WHERE org_id = ?`).
- Soft-delete via `deleted_at` for business entities; hard delete confined to pure audit tables.

## 5. Services / Use-cases

- Application services orchestrate use-cases: validate → apply → persist → emit event.
- Return results via `Result<T>` union (no throwing in domain path).
- Transactional boundaries marked by `@Transactional` decorator (Prisma tx).
- Every command has an idempotency key (see [API_SPEC](./API_SPEC.md)).

## 6. DTOs & Validation

- `class-validator` on `Create*Dto`, `Update*Dto`, `QueryDto`.
- `whitelist: true`, `forbidNonWhitelisted: true`.
- Global `ValidationPipe` with translation to `VALIDATION_ERROR` responses.
- Naming: `<Verb><Resource>Dto`; query objects `List<Resource>QueryDto`.

## 7. Dependency Injection

- Singleton scope by default; REQUEST scope only for tenancy context providers.
- Providers registered only in the owning module.
- `application` layer imports ports (`interface` tokens) — testing is clean.

## 8. Events

- Domain events (facts) emitted from services after commit.
- Bus: in-process for same-module; RabbitMQ exchange for cross-boundary.
- Event schema versioned `{ event: string; version: number; payload: ... }`.
- Outbox pattern guarantees at-least-once: insert + publish in the same transaction.

## 9. Queues (BullMQ)

- RabbitMQ fanouts to semantic queues; workers as backing job processor.
- Queues: `invoice`, `embed`, `graph`, `notify`, `summary`, `import`.
- Implemented queues today: `notifications`, `ai-jobs` (document + conversation embedding),
  `search-jobs`, `graph-jobs`, `summary-jobs` (`conversation.summarize` → LLM handoff summaries).
- Retry policy: `attempts: 3, backoff: exponential(2s)`; DLQ after exhausted.
- Jobs are idempotent (re-run safe).

## 10. Caching

- Redis cache facade (`shared/cache`), TTL configured via packages/config.
- Invalidate on write by entity (explicit keys), never TTL sweep-only.
- Cache-aside for reads; annotated with a cache key strategy.

## 11. Logging (Pino)

- Structured JSON logs; `req_id` (correlation), `org_id`, `user_id` bound globally.
- Levels per NODE_ENV: development=debug, production=info.
- Sensitive data never logged (tokens, PII bodies) — `redact` paths + guard.

## 12. Configuration

- `@nestjs/config` loads from env with validation schema (`packages/config`).
- All keys documented in `.env.example`; validation throws on missing env in prod.
- Secrets via Kubernetes secrets in prod; `.env` local only.

## 13. Error handling

- Global exception filter maps `ApiError` → the standard [error contract](./API_SPEC.md).
- Domain errors stay typed; HTTP translation at the boundary only.
- Interceptor appends `requestId` to all responses/logs.
- Async job failure translated errors to DLQ metadata for observability.

## 14. Health & lifecycle

- `@nestjs/terminus` health checks for DB/Redis/RabbitMQ/MinIO/Qdrant.
- Graceful shutdown (SIGTERM): stop accepting, drain queues, flush traces.
- `main.ts` registers `setupOpenTelemetry()` before bootstrap.

## 15. Related

- [Typescript APIs](../../README.md#api)
- [Privacy & data flows](./SECURITY_SPEC.md)
- [Deployment contract](../devops/)
