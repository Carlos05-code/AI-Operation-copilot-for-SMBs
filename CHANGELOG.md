# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository foundation (Phase 1):
  - Monorepo structure with Turborepo + pnpm workspaces
  - Flutter mobile app scaffold location (`apps/mobile`)
  - NestJS backend scaffold location (`apps/backend`)
  - Shared packages (`packages/shared`, `packages/ui`, `packages/config`)
  - Complete engineering documentation suite under `docs/`
  - Architecture Decision Records (ADR-0001 .. ADR-0013)
  - GitHub issue templates and CI/CD workflows
  - Infrastructure baseline (Docker Compose, Kubernetes, monitoring)
  - Design system specification and coding standards
- Backend API foundation (`@smb-copilot/backend` v0.1.0):
  - NestJS 10 application with URI versioning (`/api/v1/*`) and global validation pipe
  - Success envelope interceptor (`{ data, meta: { requestId, statusCode } }`, API_SPEC §2.1)
  - Unified error contract (`ApiError`, status→code mapping, global exception filter, API_SPEC §9)
  - Request correlation: `X-Request-Id` middleware + AsyncLocalStorage context
  - Pino structured logging with request id binding and secret redaction
  - Health module: readiness (`GET /api/v1/health`) and liveness (`GET /api/v1/health/live`)
  - OpenAPI 3.1 document at `GET /api/v1/openapi.json` (generated from decorators, API_SPEC §10)
  - Environment config validation (class-validator on `process.env`)
- PostgreSQL foundation (`prisma/`, DATABASE_SPEC §3/§8):
  - Prisma schema: organizations, users, members (RBAC), customers, products, inventory movements,
    sales orders + line items, invoices + items, tasks, documents, knowledge documents,
    notifications, audit logs, and the outbox table (DATABASE_SPEC §10)
  - Initial migration (`20260802034951_init`) with the §8 unique constraints and query indexes
  - Idempotent development seed (`prisma/seed.ts`, `pnpm db:seed`)
  - `DatabaseModule` with `PrismaService` (lazy connect when `DATABASE_URL` set) and a real
    PostgreSQL probe in the readiness endpoint (`GET /api/v1/health` reports `ok`/`unhealthy`)
- Multi-tenant authorization framework (SECURITY_SPEC §3/§4, API_SPEC §6):
  - `Role` enum aligned with the RBAC matrix: `OWNER > ADMIN > MANAGER > AGENT > VIEWER` (migration
    `20260802040000_align_rbac_roles`)
  - `AuthModule` (global): JWKS getter from `AUTH_JWKS_URL` (Keycloak)
  - `JwtAuthGuard`: RS256 bearer-token verification (signature, `iss`/`aud`/`exp`/`nbf`, claims
    `org_id` + `org.role`), fails closed when auth is not configured
  - `RolesGuard` with `@RequireRoles(...)`: hierarchical role enforcement, deny-by-default
  - `TenancyGuard`: per-request org membership via the `members` table
  - `AuthorizationService`: role ranking, `hasRole`/`hasAnyRole`, membership lookups
  - `@CurrentUser()` param decorator exposing the verified `AuthContext`
  - `jose` dependency for JWT/JWKS crypto; jest transform wired for ESM-only packages
- Identity foundation (Keycloak + OIDC, ADR-0008):
  - Realm as code: `infrastructure/keycloak/realm.json` (realm `smb-copilot`, RS256, 15-min access /
    7-day refresh with rotation)
  - Clients: `smb-copilot-ui` (public, Authorization Code + PKCE, direct grant for local dev) and
    `smb-copilot-api` (bearer-only)
  - Realm roles `owner/admin/manager/agent/viewer` (SECURITY_SPEC §4) with `org_id` (user attribute)
    and `org.role` token claim mappers consumed by `JwtAuthGuard`
  - Demo users `owner@`/`manager@`/`viewer@acme-demo.local` bound to the seeded `acme-demo` org
  - Docker Compose auto-imports the realm on first boot (`--import-realm`)
- RabbitMQ + BullMQ infrastructure (ADR-0007, ADR-0013):
  - `EventBusService`: managed AMQP connection + confirmed channel on the `copilot.domain.events`
    topic exchange, fail-soft when the broker is down
  - `OutboxService` (transactional outbox, DATABASE_SPEC §10): `append()` inside caller
    transactions; background relay (5s poll, batch 50) publishes PENDING events with the event type
    as routing key and marks them PROCESSED/FAILED — rows stay PENDING while the bus is disconnected
    (at-least-once)
  - `QueueModule`: BullMQ with `notifications` + `ai-jobs` queues on Redis (`REDIS_URL` parsing via
    `redisConnectionOptions`) and exponential-retry defaults; `QueueService` enqueue facade
  - Both modules global + lazy/fail-soft: local runs without Redis/RabbitMQ boot normally
  - Unit tests: outbox relay (success/failure/disconnected/no-op) and Redis URL parsing
- Object storage integration (MinIO, SECURITY_SPEC §10, ADR-0007):
  - `StorageModule` (global) with a MinIO client factory from `STORAGE_ENDPOINT` /
    `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` / `STORAGE_REGION`; inert when
    unset so local runs without MinIO boot normally
  - `StorageService`: presigned PUT (`POST /api/v1/storage/uploads/presign`) and GET
    (`GET /api/v1/storage/objects?key=...`) URLs with opaque org-scoped object keys
    (`{org_id}/{uuid}`) and sanitized filenames as metadata only
  - Guard chain per API_SPEC §6: `JwtAuthGuard` → `TenancyGuard` → `RolesGuard`; uploads require
    agent-or-above scope, downloads any member
  - `STORAGE_UNAVAILABLE` (503) error code; DTO validation via the global validation pipe
  - Compose MinIO healthcheck fixed (`curl` liveness probe); health report lists MinIO as a
    dependency
  - Unit tests: endpoint/config parsing, presign delegation, fail-soft behavior, controller scoping
- Document ingestion pipeline (ROADMAP Phase 2, AI_ARCHITECTURE §4):
  - `IngestionModule`: `POST /api/v1/documents` (register an uploaded object),
    `GET /api/v1/documents/:id` (status), `POST /api/v1/documents/:id/ingest` (run the pipeline)
  - `IngestionService`: `PENDING/FAILED → PROCESSING → INDEXED` lifecycle; downloads bytes from
    MinIO, extracts text (`pdf-parse` for PDF text layers, UTF-8 for `text/plain`), cleans (NFKC
    normalization, control-char stripping, page-number footer removal), stores a `clean.txt`
    sidecar, upserts the `knowledge_documents` row, emits `document.ingested` on the outbox, and
    enqueues an `ai-jobs` embedding job (fire-and-forget; Redis down does not fail ingestion)
  - Failures mark the document `FAILED` and emit `document.ingestion_failed`
  - `StorageService.getObject`/`putObject` server-side access with stream collection
  - Migration `20260816020000_add_document_clean_text_key` (`documents.clean_text_key`)
  - `UNSUPPORTED_DOCUMENT` (422) error code for unsupported/scanned content (OCR deferred)
  - Unit tests: cleaner heuristics, extraction providers, pipeline orchestration (happy path,
    storage-down, extraction failure, re-ingestion conflict, org scoping, DB-not-configured)
- Embedding pipeline (chunking + embeddings + Qdrant, AI_ARCHITECTURE §4, DATABASE_SPEC §5):
  - `EmbeddingsModule` with a BullMQ `ai-jobs` worker (`EmbeddingsWorker`, `@Processor`) consuming
    `document.ingested` jobs: downloads the `clean.txt` sidecar, chunks, embeds in batches of 64,
    and upserts vectors into Qdrant
  - `ChunkerService` (`chunker.ts`): sentence-aligned chunks (~384 tokens) with 64-token overlap,
    never splits mid-sentence; oversized sentences become their own chunk
  - `EmbeddingProvider`: OpenAI-compatible `POST {url}/embeddings` client (`EMBEDDINGS_API_URL`/
    `EMBEDDINGS_API_KEY`/`EMBEDDINGS_MODEL`, default `BAAI/bge-m3`); failures map to
    `EMBEDDINGS_UNAVAILABLE` (503)
  - `VectorStoreService`: per-org Qdrant collection `doc_chunks_{org}` (Cosine,
    `EMBEDDINGS_DIMENSION` default 1024) with payload indexes on `org_id`/`source_document_id`;
    deterministic point ids `sha1(documentId:index)` for idempotent re-runs; failures map to
    `VECTOR_STORE_UNAVAILABLE` (503)
  - `document.embedded` outbox event; jobs retry 3× with exponential backoff and fail-soft when
    embeddings/Qdrant are not configured (worker skips, API keeps working)
  - `@qdrant/js-client-rest` dependency; env validation for `EMBEDDINGS_*` / `QDRANT_*`; health
    reports `embeddings` and `qdrant` as configured dependencies
  - Unit tests: chunker heuristics, provider requests/errors, collection management/upserts, worker
    orchestration (happy path, not configured, storage-down, provider failure, outbox-down)
- Queue reliability fix: BullMQ Redis `retryStrategy` is now bounded (gives up after ~20s) so a dead
  Redis can no longer hang `Worker.close()` during app shutdown (previously the e2e suite and
  `app.close()` would wait forever on `waitUntilReady`)
- Full-text search + hybrid retrieval (OpenSearch, ADR-0012, AI_ARCHITECTURE §5, DATABASE_SPEC §7):
  - `SearchModule` with a BullMQ `search-jobs` worker (`SearchWorker`, `@Processor`): consumes
    `document.index` jobs enqueued by ingestion alongside the embedding job, downloads the
    `clean.txt` sidecar, re-chunks with the shared chunker, and bulk-indexes chunks into the org's
    `search_{org}` index (deterministic `sha1(documentId:index)` ids, idempotent re-runs)
  - `SearchService`: per-org OpenSearch index with analyzed `text` + keyword payload fields;
    `multi_match` keyword search with an org filter; missing index = empty result; failures map to
    `SEARCH_UNAVAILABLE` (503); not configured → fail-soft (worker skips, API keeps working)
  - `VectorStoreService.searchSimilar` (Qdrant `query` endpoint) returning store-agnostic hits;
    Qdrant payloads now carry the full chunk `text` (≤ 4000 chars) so vector-only retrieval can
    serve citations
  - `HybridSearchService`: top-20 candidates per configured store fused with RRF (k=60); degrades
    gracefully when a store is unconfigured or fails at query time, throwing `SEARCH_UNAVAILABLE`
    only when nothing could be queried
  - `POST /api/v1/search` (`{query, limit}`) behind the standard guard chain, scoped to the
    requesting member's org (any authenticated role)
  - `document.indexed` outbox event; `search-jobs` queue registered; `SEARCH_UNAVAILABLE` error
    code; `OPENSEARCH_*` env validation; health reports `search` as a configured dependency
- `@opensearch-project/opensearch` dependency
  - Unit tests: config resolution, index lifecycle/bulk/search + error mapping, worker orchestration
    (happy path, not configured, storage down, cluster down, outbox down), RRF fusion + degradation
    matrix; e2e: unauthenticated search → 401 error envelope
- Knowledge-graph indexing + graph-expanded retrieval (Neo4j, ADR-0005, DATABASE_SPEC §4):
  - `GraphModule` with a BullMQ `graph-jobs` worker (`GraphWorker`, `@Processor`): consumes
    `document.graph` jobs enqueued by ingestion, downloads the `clean.txt` sidecar, re-chunks, and
    merges the subgraph `(:Document)-[:HAS_CHUNK]->(:Chunk)-[:CONTAINS]->(:Entity)` into Neo4j with
    idempotent `MERGE`s keyed on deterministic ids (re-runs converge)
  - `EntityExtractor`: deterministic LLM-free extraction (emails, URLs, ALL-CAPS acronyms,
    capitalized multi-word phrases; honorific-prefixed names become `person`) with canonical
    lowercasing, dedupe, and per-chunk caps
  - `GraphService`: upsert + `searchByEntities` (chunks mentioning query entities, scored by
    matches); failures map to `GRAPH_UNAVAILABLE` (503); not configured → fail-soft
  - `HybridSearchService` graph stage: entities extracted from the query are expanded 1 hop through
    the graph; three-store RRF fusion with the same graceful degradation contract
  - `document.graph_indexed` outbox event; `graph-jobs` queue registered; `GRAPH_UNAVAILABLE` error
    code; `NEO4J_*` env validation; health reports `graph` as a configured dependency
  - `neo4j-driver` dependency (`disableLosslessIntegers` for plain-number scores)
  - Unit tests: extractor heuristics, config resolution, MERGE params + hit mapping + error mapping,
    worker orchestration (happy path, not configured, storage down, graph down, outbox down), hybrid
    3-way fusion + degradation matrix
- Grounded chat with citations and confidence scoring (`POST /api/v1/chat`, AI_ARCHITECTURE §6–§10,
  API_SPEC §11.5):
  - `ChatModule` with `LlmProvider`: OpenAI-compatible `/chat/completions` client (non-streaming,
    single-shot, `temperature 0.2`, `max_tokens 700`); unconfigured/unreachable → `LLM_UNAVAILABLE`
    (503); `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL` env (`.env.example`)
  - `qa.document.v1` prompt with the full system boundary: knowledge-base only, tenancy refusal,
    `[source:<document_id>:<chunk_id>]` tags, and the structured JSON answer contract
  - `ChatService` pipeline: hybrid retrieval (3-store RRF) → context budget (800 chars/chunk, 12 000
    total, tail elided) → single-shot LLM → deterministic grounding
  - **Deterministic grounding first**: model citations validated against the actual retrieved
    context (unknown citations dropped — constrained generation), `grounded` gated on the fused
    score threshold, `confidence` heuristic formula, `synthesis` `direct|derived|fallback`;
    LLM-as-judge verification planned
  - Retrieval quality gate: no relevant context → disclaimer answer, LLM never called
  - `LLM_UNAVAILABLE` error code; `LLM_*` env validation; health reports `llm` dependency
  - Unit tests: LLM config, provider (HTTP/error/shape mapping), grounding (fences, validation,
    thresholds, synthesis tiers, caps), chat service (disclaimer, grounding, invented-citation drop,
    budget trimming, LLM/malformed/retrieval failures); e2e: unauthenticated chat → 401

### Changed

- Design system promoted from Draft to Ratified (`docs/specifications/DESIGN_SYSTEM.md`)
- Design tokens are now AA-verified and enforced by a CI contrast gate

## [0.1.0] - 2026-08-02

### Added

- Design system foundation (`packages/ui`):
  - TypeScript token source of truth (colors, typography, spacing, radii, elevation, motion,
    breakpoints) with JSDoc
  - WCAG 2.1 contrast utilities and a CI contrast gate (fails under AA)
  - Platform generators producing `generated/tokens.css`, `generated/tokens.dart` (Flutter), and
    `generated/tokens.json`
  - Unit tests (node:test) for token integrity, 4px grid, radii, and contrast
