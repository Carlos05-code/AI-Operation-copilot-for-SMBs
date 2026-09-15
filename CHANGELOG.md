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
- Customer conversation ingestion (`POST /api/v1/conversations`, DATABASE_SPEC §3, §5, API_SPEC
  §11.6):
  - Prisma `conversations` + `messages` tables (migration `add_conversation_messages`): org-scoped
    threads with `channel` (`WHATSAPP | EMAIL | SLACK`) and per-message `sender`
    (`CUSTOMER | AGENT | SYSTEM`), `sent_at`; idempotency via `(organization_id, external_id)` /
    `(conversation_id, external_id)` uniques
  - `ConversationsModule` with `POST /api/v1/conversations` (agent-or-above): persists the
    conversation (upsert by external id), inserts messages (`createMany` + `skipDuplicates`), emits
    `conversation.ingested` on the outbox, and enqueues a `conversation.embed` job — outbox/queue
    failures are logged, never fatal (DB row is the system of record)
  - `ConversationWorker` on the shared `ai-jobs` queue: loads messages from PostgreSQL, embeds
    bodies in batches, and upserts per-message vectors into `conversation_{org}` with deterministic
    ids (`sha1(conversationId:messageId)`) and payload
    (`org_id, conversation_id, customer_id, channel, sender, message_id, sent_at, text`); emits
    `conversation.embedded`; fail-soft skips when not configured
  - `VectorStoreService` conversation collection support (`ensureConversationCollection`,
    `upsertConversationMessages`, `conversationMessagePointId`)
- Unit tests: service (persist, external-id idempotency, customer scoping 404, outbox/queue failure
  swallowing, DB unconfigured), worker (skip rules, batching, upsert payloads, embedding failure
  propagation, outbox swallowing), vector store (collection lifecycle, deterministic ids, payloads,
  error mapping); e2e: unauthenticated ingestion → 401
- Knowledge base surface with org-scoped access control (`GET /api/v1/knowledge[/:id]`, ROADMAP
  Phase 2, API_SPEC §11.7):
  - `KnowledgeModule` with read-only browsing of the org knowledge registry (INDEXED documents
    only): paginated list (newest first, `page`/`limit` with `pagination` metadata and
    `X-Total-Count` header) and single-entry fetch
  - Entity-level tenancy: every query filters by `organizationId` from the verified token;
    foreign/absent entries surface as 404 (existence never leaks across orgs)
  - `knowledge_documents.document_id` now a real FK to `documents` (migration
    `knowledge_document_relation`); entries expose linked document metadata (name, type, size,
    status)
  - Unit tests: pagination math, empty org, cross-org 404 scoping, DB unconfigured; e2e:
    unauthenticated list/get → 401
- Conversation summaries with org-scoped surface (ROADMAP Phase 4, AI_ARCHITECTURE §6.1, API_SPEC
  §11.8):
  - `ConversationSummaryWorker` on the new `summary-jobs` queue (`conversation.summarize`): loads
    the thread, windows the transcript to a 20k-char tail budget, runs the
    `summarize.conversation.v1` prompt through the shared LLM, persists `{summary}` +
    `summaryGeneratedAt` on the row (idempotent — no-op when the stored summary is newer than the
    last message), and emits `conversation.summarized` on the outbox
  - `POST /api/v1/conversations/:id/summarize` schedules the job (agent-or-above, org-scoped 404,
    fail-soft enqueue); `GET /api/v1/conversations` (paginated, newest updated first,
    `X-Total-Count`) and `GET /api/v1/conversations/:id` (thread + summary) expose it
  - `conversations.summary` + `summary_generated_at` columns (migration `add_conversation_summary`);
    `LlmProvider.complete` gained an optional `maxTokens` override
- Unit tests: worker (happy path + event, freshness skip, regeneration, windowing/truncation note,
  malformed payload retry, fail-soft), service (scheduling, org-scoped 404, list/get); e2e:
  unauthenticated list/get/summarize → 401
- Channel connectors: WhatsApp / email / Slack inbound adapters (ROADMAP Phase 2, API_SPEC §11.9):
  - `POST /api/v1/connectors/:channel/inbound` accepts channel-native payloads and funnels them into
    the canonical conversation pipeline (agent-or-above; org-scoped)
  - Customer resolution by channel identity: WhatsApp via normalized `Customer.whatsapp`, email via
    `Customer.email` (case-insensitive), Slack via profile email — unknown identities provision a
    new org customer
  - Deterministic thread keys (`wa:{number}`, `mail:{threadId|messageId|sha1(subject)}`,
    `slack:{threadTs|channel:user}`) make re-delivered webhooks idempotent via the existing
    `(organization_id, external_id)` upsert
  - Per-channel payload validation: missing required fields or invalid timestamps → 400
    (`VALIDATION_ERROR`); unknown channels → 400
  - Unit tests: per-channel mapping/normalization, customer match + provisioning, thread key
    derivation, 400s, DB unconfigured; e2e: unauthenticated inbound → 401
- Executive dashboard (ROADMAP Phase 3, API_SPEC §11.10):
  - `GET /api/v1/dashboard/summary` — org-scoped snapshot: revenue (`PAID` totals, all-time +
    current/last UTC calendar month), receivables (`SENT`+`OVERDUE` outstanding/overdue split), task
    load (open, overdue, due-today, open split by priority), alerts (unread count + 5 latest)
  - Money as exact decimal strings (`toFixed(2)`) — first endpoint to serialize money; convention
    documented in API_SPEC §11.10
  - Unit tests: full aggregation + org scoping of every query, empty-org zeros, DB unconfigured;
    e2e: unauthenticated summary → 401
- AI task planning (ROADMAP Phase 3, AI_ARCHITECTURE §6.1 `plan.tasks`, API_SPEC §11.11):
  - `POST /api/v1/tasks/plan` schedules a `task.plan` job on the shared `ai-jobs` queue;
    `TaskPlanningWorker` collects deterministic signals (overdue invoices top-20, products below
    reorder point with stock = `sum(IN) − sum(OUT) + sum(ADJUST)`), runs `plan.tasks.v1` through the
    shared LLM, validates the JSON plan (priorities, ISO dates), and persists tasks with
    `agentMetadata` (`promptVersion`, `signalKey`, `reason`)
  - Dedupe by signal key: an open task with the same `agentMetadata.signalKey` (jsonb path query) is
    never duplicated across runs; `task.planned` outbox event with counts
  - Task surface: `GET /api/v1/tasks` (priority-desc order, §4 pagination, `status` filter),
    `GET /api/v1/tasks/:id`, `PATCH /api/v1/tasks/:id` (status updates) — all org-scoped, foreign
    tasks 404
  - Unit tests: worker (signals, LLM plan validation, dedupe, low-stock convention, skips, malformed
    payload retry, outbox swallow), service (list/get/update org scoping, plan scheduling
    fail-soft); e2e: unauthenticated list/get/patch/plan → 401
- Invoice generation & recurring invoicing (ROADMAP Phase 3, API_SPEC §11.12):
  - `POST /api/v1/invoices` prices submitted line items in integer-cent math (per-line tax,
    subtotal/taxTotal/total as exact decimal strings), allocates a per-org, per-year invoice number
    `INV-<year>-<seq>` (retried on a concurrent P2002 collision), and writes the invoice + items in
    one transaction; `issue: true` creates it already `SENT`
  - Lifecycle state machine: `POST /api/v1/invoices/:id/{issue,pay,void}` — `DRAFT→SENT`,
    `SENT|OVERDUE→PAID`, `DRAFT|SENT|OVERDUE→VOID`; illegal transitions are `409 CONFLICT`, repeat
    of the current state is idempotent; `issuedAt`/`paidAt` stamped;
    `invoice.{created,issued,paid,voided}` outbox events
  - `GET /api/v1/invoices` (newest first, §4 pagination, `status` filter) and
    `GET /api/v1/invoices/:id` (with line items) — org-scoped, foreign invoices 404
  - Recurring invoicing: `RecurringInvoice` model (`RecurrenceCadence`
    WEEKLY/MONTHLY/QUARTERLY/YEARLY, interval, net-terms, `issueOnCreate`, JSON template) with CRUD
    at `/api/v1/recurring-invoices` (`create`, list, get, `:id/pause`, `:id/resume`, `DELETE :id`);
    templates are priced and validated at create time. `InvoiceRecurrenceWorker` (`ops-jobs` queue,
    `invoice.recurrence.run`) generates the next invoice for every due schedule and advances
    `nextRunAt` in the same transaction, guarded on the observed `nextRunAt` so a concurrent run
    can't double-bill (`invoice.recurrence.generated`)
  - `InvoiceOverdueWorker` (`ops-jobs`, `invoice.overdue.sweep`) flips past-due `SENT` invoices to
    `OVERDUE` and raises an in-app `Notification` for every OWNER/ADMIN/MANAGER — surfaced by the
    executive dashboard `alerts` lens; guarded `updateMany` prevents re-notifying
    (`invoice.overdue`)
  - New `ops-jobs` BullMQ queue for non-AI operational jobs; migration
    `20260902120000_add_recurring_invoices` (`recurring_invoices` table,
    `invoices.recurring_invoice_id` / `note` / `issued_at` / `paid_at`, `(status, due_date)` index);
    seed adds a monthly schedule
  - Unit tests: money/schedule helpers (cent math, month-end clamping, cadence advance), invoice
    service (pricing, numbering + collision retry, customer/product scoping, every transition +
    409/404, recurrence generation + race), both workers (name-mismatch/not-configured skips, batch
    counts, race vs. failure isolation, recipient caching, no-double-notify); e2e: unauthenticated
    invoice + recurring-invoice endpoints → 401
- Inventory tracking with reorder alerts (ROADMAP Phase 3, DATABASE_SPEC §5):
  - `ProductService`: `POST/GET/PATCH /api/v1/products` catalog CRUD; every response carries a
    computed `onHand` (batched across a page, not N+1) from the on-hand convention shared with AI
    task planning (`sum(IN) − sum(OUT) + sum(ADJUST)`); `sku` is immutable after creation (stripped
    by the global validation whitelist); `active`/`lowStock` list filters
  - `InventoryService`: `POST /api/v1/products/:id/movements` appends to the append-only
    `inventory_movements` ledger (`IN`/`OUT` positive quantities, `ADJUST` signed for stocktake
    corrections) and immediately re-evaluates the product's reorder state;
    `GET /api/v1/products/:id/movements` (paginated ledger) and `GET /api/v1/products/:id/stock`
    (on-hand snapshot)
  - Reorder alerts are edge-triggered on a new `Product.belowReorderPoint` flag (guarded
    `updateMany`, the same pattern as the invoice-overdue sweep): exactly one in-app `Notification`
    to every OWNER/ADMIN/MANAGER per dip below the reorder point (`inventory.reorder_alert`), and
    the flag clears silently once stock recovers (`inventory.restocked`), re-arming the next dip.
    Fires immediately from `recordMovement`/updating `reorderPoint` or `active`;
    `InventoryReorderWorker` (`ops-jobs`, `inventory.reorder.sweep`, triggered manually via
    `POST /api/v1/inventory/sweep-reorder-alerts`) is the periodic safety net for crossings that
    happen without a movement (e.g. a raised `reorderPoint`), caching each org's alert recipients
    once per sweep batch
  - Migration `20260913140000_add_product_reorder_alert_state` (`products.below_reorder_point`,
    `(active, reorder_point)` index); seed adds receiving movements so one seeded product (the
    brewing scale) starts below its reorder point
  - Unit tests: stock-ledger helpers (on-hand math, low-stock predicate), product service
    (create/409-duplicate-sku/validation, list with batched on-hand, update triggering
    re-evaluation), inventory service (movements, quantity validation per movement type, the full
    alert/restock/no-double-notify/inactive-product/recipient-cache matrix), the sweep worker
    (skips, tallying, shared recipient cache, per-product failure isolation); e2e: unauthenticated
    product + inventory endpoints → 401
- Notification delivery — email (ROADMAP Phase 3, BACKEND_SPEC §12):
  - `EmailProvider`: SMTP client (`nodemailer`) gated on `SMTP_HOST` + `SMTP_FROM`; takes an
    already-constructed `Transporter` via DI (same pattern as `VectorStoreService`/`QdrantClient`),
    fails soft with `EMAIL_UNAVAILABLE` (503) when unconfigured or the send throws
  - `NotificationDeliveryWorker` (the long-registered, previously idle `notifications` queue,
    `notification.delivery.sweep`): emails every `PENDING`/`FAILED` `Notification` row to its
    recipient's `User.email`, decoupled from and requiring no changes to the invoice-overdue or
    inventory-reorder-alert workers that create those rows. A guarded `updateMany` claims the
    outcome (same pattern as those sweeps); only `SENT` is terminal — a missing email, an
    unconfigured provider, or a thrown send error leaves the row `FAILED` and self-heals on the next
    sweep rather than a permanent `SKIPPED`, so a transient SMTP outage or a later-added `SMTP_HOST`
    recovers without operator intervention
  - `POST /api/v1/notifications/sweep-delivery` triggers the sweep manually, mirroring
    `/invoices/sweep-overdue` and `/inventory/sweep-reorder-alerts`
  - New `Notification.deliveryStatus`/`deliveredAt`/`deliveryError` columns +
    `(deliveryStatus, createdAt)` index (migration
    `20260913150000_add_notification_delivery_status`); `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` /
    `SMTP_PASSWORD` / `SMTP_FROM` env vars
  - WhatsApp outbound delivery is explicitly deferred (not stubbed): it needs a WhatsApp Business
    API/Twilio integration with an approved sender and templates, unavailable in this environment;
    `NotificationKind.WHATSAPP` stays reserved for that provider
  - Unit tests: SMTP config parsing, provider send/fail-soft, the delivery worker (name-mismatch/
    not-configured skips, PENDING+FAILED query, send/claim, no-email-on-file, provider-not-
    configured, thrown-error truncation, no-double-claim, batched recipient lookup); e2e:
    unauthenticated sweep-delivery → 401
- Appointment scheduling (ROADMAP Phase 3, DATABASE_SPEC §3):
  - `AppointmentService`: `POST/GET/PATCH /api/v1/appointments` booking CRUD. Overlap detection for
    an `assigneeId` rejects a new or rescheduled booking with `409 CONFLICT` when the assignee
    already holds a `SCHEDULED`/`CONFIRMED` slot in that window — a cancelled, completed, or no-show
    booking never blocks a new one; unassigned appointments skip the check entirely.
  - Lifecycle state machine mirrors `InvoiceService`:
    `POST /api/v1/appointments/:id/{confirm, cancel,complete,no-show}` —
    `SCHEDULED → {CONFIRMED,CANCELLED,COMPLETED,NO_SHOW}`,
    `CONFIRMED → {CANCELLED,COMPLETED,NO_SHOW}`; illegal transitions are `409 CONFLICT`, repeating
    the current status is idempotent; `appointment.{created,rescheduled,status_changed}` outbox
    events.
  - `GET /api/v1/appointments` (soonest first, §4 pagination, `from`/`to`/`assigneeId`/`status`
    filters), `GET /api/v1/appointments/:id` — org-scoped, foreign appointments 404.
  - `AppointmentReminderWorker` (`ops-jobs`, `appointment.reminder.sweep`, triggered manually via
    `POST /api/v1/appointments/sweep-reminders`) raises one in-app `Notification` per
    `SCHEDULED`/`CONFIRMED` appointment starting within `REMINDER_WINDOW_HOURS` — to the assigned
    staff member when set, otherwise every OWNER/ADMIN/MANAGER of the org (the same fallback the
    invoice-overdue and inventory-reorder-alert sweeps use). `reminderSentAt` is a guarded one-shot
    claim, the same pattern as those sweeps, so a re-run never double-reminds.
  - Migration `20260913160000_add_appointments` (`appointments` table + `AppointmentStatus` enum;
    `(organization_id, start_at)` / `(assignee_id, start_at)` / `(status, start_at)` indexes).
  - Unit tests: service (booking + conflict detection, date-range/filter list, plain edits vs.
    reschedule-with-re-check, every lifecycle transition + 409/idempotent/404, 503), the reminder
    worker (name-mismatch/not-configured skips, assignee vs. org-wide recipients, no-double-remind,
    recipient caching, per-appointment failure isolation); e2e: unauthenticated appointment
    endpoints → 401
- Purchase recommendations (ROADMAP Phase 3, AI_ARCHITECTURE §6.1 `recommend.reorder`):
  - `PurchaseRecommendationWorker` (`ai-jobs`, `purchase.recommend.sweep`, triggered manually via
    `POST /api/v1/purchasing/recommendations/sweep`): collects every active, below-reorder-point
    product across all orgs, groups by org, and for each org runs the `recommend.reorder.v1` prompt
    over that org's on-hand/reorder-point/trailing-30-day-consumption signals to decide a quantity
    and reasoning per product. One `PurchaseRecommendation` row per product per dip — a product
    already carrying a `PENDING` recommendation is never duplicated. A malformed model response or
    any other per-org failure is logged and the sweep continues with the next org (one org's LLM
    hiccup never blocks another org's recommendations).
  - `PurchaseRecommendationService`: `GET /api/v1/purchasing/recommendations` (pending first, §4
    pagination, `status` filter), `GET /api/v1/purchasing/recommendations/:id` — org-scoped, foreign
    recommendations 404. Lifecycle mirrors `AppointmentService`:
    `POST /api/v1/purchasing/recommendations/:id/{order,dismiss}` — `PENDING → {ORDERED,DISMISSED}`
    only, both terminal; resolving an already-resolved recommendation is `409 CONFLICT`.
  - Notifies every OWNER/ADMIN/MANAGER of the org (in-app) for each newly created recommendation;
    `purchase.recommended` outbox event per org sweep.
  - Migration `20260914120000_add_purchase_recommendations` (`purchase_recommendations` table +
    `PurchaseRecommendationStatus` enum; `(organization_id, status)` / `(product_id, status)`
    indexes).
  - Unit tests: worker (LLM recommendations → persist, dedupe against a still-`PENDING` row, reject
    a `productId` outside the signal set, per-org fail-soft on malformed output,
    not-configured/no-signal skips), service (list/get/lifecycle/409/404/503, sweep enqueue
    fail-soft); e2e: unauthenticated purchase-recommendation endpoints → 401
- Sales forecasting (ROADMAP Phase 4, PROJECT_SPEC §7.7):
  - `GET /api/v1/forecasting/sales` (`lookbackDays`/`horizonDays` query params) — a deliberately
    simple, transparent forecast: buckets `PAID` invoice totals into UTC calendar days over
    `[today - lookbackDays, today)`, fits an ordinary-least-squares linear trend, layers an additive
    day-of-week seasonal adjustment on the residuals, and projects `horizonDays` forward. No LLM —
    every number in the response (`trend.dailySlope`, `seasonality` per weekday) is derivable by
    hand from the `history` it returns.
  - Falls back to a flat average (`method: "insufficient_data_flat_average"`,
    `insufficientData: true`) when fewer than 3 days in the window carry any revenue at all — too
    little signal for a trend line to mean anything; forecast values are never negative.
  - Pure math lives in `forecast.ts` (`bucketDailyRevenue`, `fitLinearTrend`, `weekdaySeasonality`,
    `buildSalesForecast`) — no I/O, fully unit-testable; `SalesForecastService` wraps it with the
    org-scoped Prisma query, mirroring `DashboardService`'s revenue convention. Read-only, open to
    any member.
  - Unit tests: pure math (bucketing/gap-filling, OLS trend recovery, weekday-bias isolation,
    insufficient-data fallback, negative-forecast clamping), service (query bounds/clamping, revenue
    bucketing, 503); e2e: unauthenticated sales-forecast endpoint → 401
- Executive insights briefings (ROADMAP Phase 4, AI_ARCHITECTURE §6.1 `insight.executive`):
  - `ExecutiveBriefingWorker` (`ai-jobs`, `insight.executive.briefing`, triggered per-org via
    `POST /api/v1/insights/briefings/generate`): collects one KPI snapshot — revenue, receivables,
    open/overdue tasks, below-reorder-point product count, pending purchase recommendations,
    appointments in the next 7 days, unread alerts — and runs the `insight.executive.v1` prompt over
    it to produce a short narrative grounded strictly in those numbers (summary, highlights, risks,
    focus areas; at most 5 entries each). Malformed model output throws so BullMQ retries, same
    contract as `TaskPlanningWorker`.
  - `ExecutiveBriefingService`: `GET /api/v1/insights/briefings` (newest first, §4 pagination),
    `GET /api/v1/insights/briefings/latest` (404 if none yet), `GET /api/v1/insights/briefings/:id`
    — org-scoped, foreign briefings 404. Briefings are append-only — never edited, only generated
    fresh — and persist the exact signal snapshot the model reasoned over (`signals`, plus
    `promptVersion`) for transparency/audit.
  - Migration `20260914150000_add_executive_briefings` (`executive_briefings` table,
    `(organization_id, createdAt desc)` index).
  - Unit tests: worker (signal collection, LLM briefing → persist, list truncation/validation,
    malformed-output retry, not-configured/no-LLM skips, outbox fail-soft), service
    (list/get/latest/404/503, generate-enqueue fail-soft); e2e: unauthenticated executive-briefing
    endpoints → 401
- Purchase recommendations v2 — demand-aware (ROADMAP Phase 4, AI_ARCHITECTURE §6.1
  `recommend.reorder`):
  - `PurchaseRecommendationWorker` now compares the trailing 30-day consumption against the 30 days
    before that and classifies each product `increasing`/`decreasing`/`stable` (`±15%` swing to call
    it a trend, not noise; a zero-prior period with any current consumption reads as `increasing`).
    Both figures and the classification are fed to the `recommend.reorder.v2` prompt, which is
    instructed to lean toward the higher end of the buffer when demand is increasing and the lower
    end when it's decreasing.
  - The trend snapshot (`consumedPriorPeriodDays`, `trend`) joins the existing signals in each
    recommendation's `agentMetadata`, so every recommended quantity stays traceable to the exact
    numbers the model reasoned over — no behavior or schema change beyond the richer signal set and
    the `v1` → `v2` prompt-version bump.
  - Unit tests: trend classification (`increasing`/`decreasing`/`stable`/zero-prior edge case) via
    `it.each`, and the LLM prompt content assertion updated to check for the trend signal.
- Low-risk task auto-completion with human-in-the-loop (ROADMAP Phase 4):
  - `TaskAutoCompletionWorker` (`ops-jobs`, `task.autocomplete.sweep`, triggered manually via
    `POST /api/v1/tasks/sweep-autocomplete`) — deterministic, no LLM. An open, AI-planned task
    (carrying `agentMetadata.signalKey` from `TaskPlanningWorker`) is completed only when the system
    can _verify_ its underlying signal already resolved: the linked invoice moved to `PAID`/`VOID`,
    or the linked product climbed back above its reorder point. "Low risk" means the real-world
    resolution already happened elsewhere in the system — the sweep just catches the task record up
    to it, no judgment call is made.
  - Human-in-the-loop: every auto-completion notifies the assignee (or every OWNER/ADMIN/MANAGER of
    the org when unassigned) with the exact reason; `PATCH /api/v1/tasks/:id` reopens it exactly
    like any other task, so nothing is hidden or irreversible.
  - Guarded `updateMany` claim, the same idempotent pattern as the other periodic sweeps, so a
    concurrent run never double-completes or double-notifies; a per-task failure is logged and the
    sweep continues; `task.autocompleted` outbox event per completion.
  - Unit tests: signal resolution (invoice PAID/VOID, product restocked, unresolved, no-signalKey,
    unmatched signal), assignee-vs-org-wide recipients, no-double-complete on a concurrent claim,
    per-task failure isolation, not-configured skip, outbox fail-soft; e2e: unauthenticated
    sweep-autocomplete endpoint → 401
- Visual workflow builder / rules engine (ROADMAP Phase 4, stretch) — backend only, no LLM:
  - `WorkflowRule`: an org-defined "when `<conditions>`, do `<actions>`" automation over one entity
    type (`INVOICE`/`PRODUCT`/`TASK`/`APPOINTMENT`). `conditions` and `actions` are structured JSON,
    not free-form code or an expression language — a flat, AND-only list of
    `{field, operator, value}` checks against an explicit per-entity field allowlist
    (`workflow-condition.ts`), and a flat list of actions from a fixed, safe catalog (`CREATE_TASK`,
    `SEND_NOTIFICATION`) — the same shape a future visual builder would target, one node per
    condition/action.
  - `WorkflowEngineWorker` (`ops-jobs`, `workflow.rules.sweep`, triggered manually via
    `POST /api/v1/workflows/rules/sweep`): evaluates every active rule against its org's current
    entities of the trigger type. A rule fires **once per entity, ever** — `WorkflowRun` is unique
    on `(ruleId, entityId)`, checked before acting and written inside the same transaction as the
    actions, which also doubles as a full audit trail of what fired and when.
  - `WorkflowRuleService`/`Controller`: `POST /api/v1/workflows/rules` (create),
    `GET /api/v1/workflows/rules` (+`:id`), `PATCH /api/v1/workflows/rules/:id`
    (name/conditions/actions/active — `triggerEntity` is immutable once created),
    `GET /api/v1/workflows/rules/:id/runs` (fire history). Reads open to any member; writes
    agent-or-above; the sweep trigger manager-or-above (mirrors `/invoices/sweep-overdue`).
  - Migration `20260915090000_add_workflow_rules` (`workflow_rules` + `workflow_runs` tables,
    `WorkflowTriggerEntity` enum).
  - Unit tests: pure condition/action validation and evaluation (every operator, field-schema
    rejections, action-catalog rejections), worker (fires `CREATE_TASK`/`SEND_NOTIFICATION`,
    no-match skip, fire-once guard, per-rule fail-soft, not-configured skip, outbox fail-soft),
    service (CRUD/validation delegation/404/503, sweep enqueue fail-soft); e2e: unauthenticated
    workflow-rule endpoints → 401
- OpenTelemetry — traces + metrics, log correlation (ROADMAP Phase 5, DEVOPS_SPEC §8):
  - `setupOpenTelemetry()` (`apps/backend/src/shared/telemetry/`): metrics are always on — a
    `PrometheusExporter` registered unconditionally, since a pull-based scrape needs no external
    target to reach — while traces (OTLP + `getNodeAutoInstrumentations()`) turn on only when
    `OTEL_EXPORTER_OTLP_ENDPOINT` names a real collector. Idempotent via a `globalThis` guard;
    loaded through `node -r ./dist/shared/telemetry/preload.js` (the `start`/`start:dev` scripts) so
    auto-instrumentation patches `http`/`express` before Nest ever requires them.
  - `GET /metrics` (Prometheus text format, mounted below the global prefix/versioning) — verified
    against a real scrape, not guessed: `http_request_duration` (histogram, seconds-scale buckets —
    `[0.005 .. 10]`, fine enough below the 800ms p95 alert threshold to actually resolve a
    percentile there; the SDK's own default buckets are millisecond-tuned and would collapse every
    real request into the first bucket), `http_requests_total` (counter), both labeled
    `method`/`route`/`status_code` (route = `<Controller>#<handler>`, not the raw URL, to avoid
    path-param cardinality blowup) via a global `TelemetryInterceptor`; `queue_jobs_waiting` (gauge,
    labeled `queue`) sampled from BullMQ on every scrape, one queue's Redis error never blanks the
    others (`QueueService`).
  - `PinoLoggerService` now binds `traceId`/`spanId` from the active span alongside `requestId`
    (DEVOPS_SPEC §8 "Correlation: `trace_id` + `req_id` in all logs") — inert without a registered
    `ContextManager` (tracing off, or under test), so this is safe everywhere.
  - Graceful shutdown (SIGTERM): stop accepting connections, then flush any buffered spans before
    the process exits.
  - `infrastructure/monitoring/`: a real, working `docker compose --profile monitoring up` stack —
    otel-collector → Tempo (traces), Prometheus (scrapes the API's `/metrics` directly — fixed the
    stale `worker:9464`/`redis-exporter` targets that never pointed at anything real), Grafana
    (datasources + one dashboard sourced from the exact verified metric names: request rate, p95
    latency, error rate, queue backlog). SLO alerting rules for all three DEVOPS_SPEC §8 thresholds.
    Deliberately deferred: Loki log shipping — logs are already structured JSON on stdout with
    `trace_id`/`req_id` correlation, ready to ship; only the collector pipeline is missing, and it
    needs no application code changes to add later.
  - Unit tests: `otelConfig` (pure env parsing), `setupOpenTelemetry` (metrics-only vs.
    tracing-enabled, idempotency, a real scrape against a loopback server rather than guessing the
    Prometheus exporter's response-object shape), `AppMetricsService` (HTTP recording, queue-depth
    gauge wiring), `TelemetryInterceptor` (success/error/typed-error-status/non-HTTP passthrough),
    `PinoLoggerService` (requestId/traceId/spanId binding, via a real `AsyncHooksContextManager`
    rather than a mocked `trace` API), `QueueService` (depth-gauge registration and per-queue
    fail-soft sampling).
- Kubernetes deployment with HPA (ROADMAP Phase 5, DEVOPS_SPEC §3):
  - `infrastructure/docker/Dockerfile.api` — first Dockerfile in the repo. Multi-stage pnpm build
    (`deps` → `build` runs `prisma generate` + `tsc` → `prod-deps` production-only install →
    `runtime` layers the generated `.prisma` client on top of the prod install, since a `--prod`
    install excludes the `prisma` CLI's postinstall). Moved `prisma` from `devDependencies` to
    `dependencies` in `apps/backend/package.json` — the migration Job below runs
    `prisma migrate deploy` from this same runtime image, which needs the CLI, not just
    `@prisma/client`. Non-root (`USER node`), `HEALTHCHECK` against `/api/v1/health/live`.
  - `infrastructure/kubernetes/` rebuilt as a working Kustomize tree — `base/` (namespace, `api`
    Deployment + Service + HPA + Ingress + NetworkPolicy + ServiceAccount, a `prisma migrate deploy`
    Job, StatefulSets for every stateful dependency, a Keycloak Deployment with its realm import as
    a `configMapGenerator`) plus `overlays/staging` and `overlays/production` (replica counts, HPA
    floors, image tags, ingress host/cert-issuer patched per environment). `kustomize build`
    (v5.8.1) verified clean on the base and both overlays — confirmed the image-tag transformer,
    replica patches, and HPA patches actually land in the rendered output, not just that the tool
    exits 0.
  - `api-hpa.yaml`: `autoscaling/v2`, CPU (70%) + memory (80%) utilization targets, 2-10 replicas in
    the base (1-3 staging, 3-15 production). Scaling on the `queue_jobs_waiting` metric this app
    already exports is a natural next step once a Prometheus Adapter or KEDA is actually installed
    in-cluster — not referenced here since neither is.
  - Deliberately deferred, documented rather than faked: a separate `workers` Deployment (no second
    bootstrap entrypoint exists yet — every BullMQ processor still registers on the same `main.ts`
    the API serves HTTP from, so scaling `api` scales both); and treating the in-cluster
    StatefulSets as production-grade (single replica, no failover/backup — staging convenience only,
    `overlays/production/README.md` covers the managed-service swap-out).
  - Moved `infrastructure/keycloak/realm.json` to `infrastructure/kubernetes/base/keycloak/` so
    `configMapGenerator` can reference it without reaching outside its own kustomization directory
    (a hard security restriction, not a flag) — `docker-compose.yml`'s Keycloak mount updated to the
    new path.
  - `.github/workflows/release.yml`: fixed a latent bug found while wiring the k8s manifests up to
    the real image path it pushes — `ghcr.io/${{ github.repository }}` preserves this repo's actual
    mixed case (`Carlos05-code/AI-Operation-copilot-for-SMBs`), which `docker build -t`/`push`
    reject outright since GHCR paths must be all-lowercase; there's no `lower()` in Actions
    expression syntax, so it's computed once via `tr` into `$GITHUB_ENV` instead. The k8s manifests
    reference the corrected lowercase path directly. Still a gap: `release.yml` only ever pushes the
    exact `${GITHUB_REF_NAME}` version tag on a `v*` push, never a floating `:staging`/`:production`
    tag — the overlays' `images:` tag transformer assumes a promotion step that doesn't exist yet.
  - Two dead image references found while verifying every StatefulSet container's actual default
    user against its published image config (not assumed) for Semgrep's `run-as-non-root`/
    `allow-privilege-escalation-no-securitycontext` rules — both fixed in `docker-compose.yml` and
    the k8s manifests: `minio/minio` no longer exists on Docker Hub at all (MinIO moved to Quay);
    `qdrant/qdrant:v1.9` was never a real tag (only `v1.9.0`..`v1.9.7` are published). Now
    `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` and `qdrant/qdrant:v1.9.7-unprivileged` — the
    latter chosen specifically because it's the non-root variant (verified `1000:1000` vs. the plain
    tag's `0:0`), letting its StatefulSet carry a `runAsNonRoot: true` that's actually true.
  - `allowPrivilegeEscalation: false` + `capabilities: drop: [ALL]` added to every container in
    `base/infrastructure/` and `base/keycloak/`. `runAsNonRoot: true` added for real where the
    published image config confirms a non-root default (OpenSearch uid 1000, Keycloak uid 1000,
    Qdrant's `-unprivileged` tag); `# nosemgrep`'d with a one-line reason where it isn't (Postgres,
    Redis, RabbitMQ, Neo4j, MinIO all start as root by design — their entrypoints `chown` a fresh
    volume then drop privileges themselves; forcing non-root at the pod level would stop that
    entrypoint from ever running).
- Load and resilience testing (ROADMAP Phase 5, TESTING_SPEC §6):
  - `tests/load/`: three k6 scenarios (`smoke.ts` 5 VUs/1m, `soak.ts` ramp-to-200-VUs/~30m,
    `spike.ts` ramp-to-1000-VUs/30s) sharing one weighted request mix (`lib/workload.ts`) against
    real `API_SPEC` endpoints — dashboard summary, task list, hybrid search, invoice creation
    (exercises the per-org invoice-numbering retry-on-collision path under real concurrency),
    unauthenticated liveness. `POST /api/v1/chat` deliberately excluded — it 503s whenever no LLM
    provider is configured, which would poison the error-rate threshold for reasons unrelated to the
    API's own capacity.
  - `lib/auth.ts`: the backend has no login endpoint of its own (auth is Keycloak-only bearer
    verification) — real password-grant login against Keycloak's token endpoint using the seeded
    demo users, cached per-VU and re-logged-in before the 15-minute token actually expires. Each VU
    logs in independently rather than sharing one token from `setup()`, both to avoid a
    refresh-token-rotation race across VUs and because a login stampede under the spike scenario is
    itself a real thing worth measuring.
  - `lib/thresholds.ts`: p95 < 800ms / error rate < 1% for smoke and soak — the exact DEVOPS_SPEC §8
    SLO alert numbers, not separately invented ones. Spike uses a looser bar (p95 < 2s, error rate <
    5%) since briefly degrading without cascading is the actual pass condition there.
  - Verified with a real `k6 run` (v2.2.0, confirmed native TypeScript support — no transpilation
    step) against a local mock Keycloak+API server, not just `k6 archive` syntax-checking: real
    login, all five weighted actions, thresholds evaluated, zero failures.
  - Fixed a real bug this surfaced: `apps/backend/prisma/seed.ts` never pinned the demo
    organization's id, so a fresh database's auto-generated uuid could never match the `org_id`
    claim every demo user's token carries (hardcoded in
    `infrastructure/kubernetes/base/keycloak/realm.json`) — every authenticated request would have
    failed `TenancyGuard`'s membership lookup. Now pinned to the same id the realm import uses.
  - Deliberately not done: wiring `k6 soak` into CI on `v*` tags (TESTING_SPEC §9's own diagram
    calls for it). That needs the full stack — Postgres, Redis, RabbitMQ, Keycloak, OpenSearch,
    Qdrant, Neo4j, the built API — booted inside a runner first, and no existing workflow in
    `.github/workflows/` boots more than one `services:` container to build that on
    (`db-migrate-check.yml`); shipping an unverified multi-service boot sequence risked a CI job
    that's flaky or silently wrong with no way to catch it before merging. `tests/load/README.md`
    documents running every scenario manually against a real target instead.
- Backup and disaster-recovery runbooks (ROADMAP Phase 5, DEVOPS_SPEC §9):
  - `infrastructure/kubernetes/base/backup/`: nightly CronJobs for PostgreSQL (`pg_dump -Fc`, 02:00
    UTC), Neo4j (APOC streaming export via `cypher-shell`, 02:15 UTC), Qdrant (per-collection
    snapshot via its HTTP API, enumerating collections dynamically since they're per-org, 02:30
    UTC), and OpenSearch (snapshot via its `_snapshot` API, 02:45 UTC) — all uploading to a
    dedicated `smb-copilot-backups` MinIO bucket (kept separate from the app's own bucket so a bug
    in application storage code can never touch backups) via a real `mc` binary copied in from
    `quay.io/minio/mc` (Docker Hub's `minio/mc` no longer exists either — same move to Quay as
    `minio/minio`, found while wiring this up). A one-time `minio-versioning-job.yaml` enables
    bucket versioning on both buckets.
  - `infrastructure/devops/incident.md`: the DR runbook `DEVOPS_SPEC` §9 and `docs/devops/oncall.md`
    already referenced but didn't have — restore procedures for all six stateful services, an
    RTO/RPO table, and scenario playbooks (full cluster loss, single-service corruption, a bad
    migration, region loss). Its "Known gaps" section is load-bearing, not boilerplate: no restore
    procedure here has been drilled end-to-end against a live cluster.
  - `infrastructure/kubernetes/base/infrastructure/neo4j.yaml`: `NEO4J_PLUGINS=["apoc"]` +
    `dbms.security.procedures.unrestricted=apoc.*` — APOC ships via this official env var (no custom
    image), needed for the backup CronJob's streaming export (Community Edition has no online
    `neo4j-admin backup`).
  - `infrastructure/kubernetes/base/infrastructure/redis.yaml`: added `--save` RDB snapshot
    intervals alongside the AOF that was already there (DEVOPS_SPEC §9: "AOF + scheduled RDB").
  - `infrastructure/kubernetes/base/infrastructure/opensearch.yaml`: a second PVC + `path.repo` for
    an `fs`-type snapshot repository — no `repository-s3` plugin installed, so these snapshots
    protect against index corruption/accidental delete, not against losing that PVC (documented as a
    gap in both `DEVOPS_SPEC.md` §9 and the runbook, not silently shipped as if it were complete).
  - Three real bugs the security scanner and the review of each image's actual default user caught,
    same discipline as the earlier Kubernetes PR: the postgres/neo4j/qdrant/opensearch backup jobs
    initially claimed `runAsNonRoot: true` copy-pasted from `api-deployment.yaml` without
    re-checking that `postgres:16-alpine`/`neo4j:5-community`/`alpine:3.24.1` all run as root by
    default (the same images this repo's own `infrastructure/` StatefulSets already document as
    root-required) — fixed with the same `# nosemgrep` + verified-image-config comment pattern; and
    the qdrant/opensearch jobs' `capabilities: drop: [ALL]` would have broken `apk add` (needs
    `CAP_CHOWN`/`CAP_DAC_OVERRIDE`), so that line was dropped for those two containers only, with a
    comment explaining why.
  - All four backup shell scripts (`backup-scripts-configmap.yaml`) syntax-checked with `sh -n`; all
    new/changed Kubernetes manifests verified with a real `kustomize build` against the base and
    both overlays, not just YAML syntax.
- Large-document-volume benchmark tooling (ROADMAP Phase 5):
  - `tests/benchmarks/large-corpus/`: `generate-corpus.mjs` (a deterministic, seeded synthetic
    document generator — recombines a small bank of real-sounding business-document sentence
    templates rather than repeating one paragraph, since a corpus that collapses to near-identical
    vectors would say nothing about retrieval at scale), `ingest-corpus.mjs` (bulk-ingests a
    directory through the real API pipeline — presign, PUT to MinIO, register, ingest — with bounded
    concurrency and per-document latency logging), `report.mjs` (throughput/percentile summary from
    an ingest run's log). Plain Node ESM (`.mjs`), not k6 — bulk-loading hundreds of thousands of
    local files needs real filesystem streaming, which doesn't fit k6's init-context-only file
    access; `tests/load/` remains the right tool for concurrent-user query load, this is the
    orthogonal axis (fixed concurrency, varying corpus/index size).
  - Verified end-to-end (real login/presign/PUT/register/ingest HTTP calls) against a local mock
    server — no live backend+Keycloak available to actually run the 200k-document benchmark this
    ships the tooling for.
  - `README.md`: a capacity-estimate table computed from this app's own chunking constants
    (`embeddings.constants.ts` — 384-token chunks, 64-token overlap, 1024-dim vectors) rather than
    guessed round numbers, a results template left blank pending a real run, and an explicit "Known
    limitations" section (small fixed vocabulary, ingest throughput ≠ embedding-completion
    throughput, Neo4j's row deliberately left unestimated rather than guessed).

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
