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
- Multi-region readiness ADR (ROADMAP Phase 5):
  - `docs/architecture/adrs/ADR-0014-multi-region.md` (Status: Proposed): a phased,
    backup-restore-first decision rather than committing to active-active replication speculatively.
    Phase A (already shipped, just named correctly) is the existing nightly-backup + restore-runbook
    disaster recovery — the platform can come back up in a new region in hours, it doesn't run in
    multiple regions simultaneously. Phases B (async replication for the stores that support it in
    their OSS tier — PostgreSQL, OpenSearch, MinIO, and with more operational work Redis/RabbitMQ)
    and C (Neo4j) are named but deliberately not started without a concrete driver.
  - The decision turns on one verified constraint: `neo4j:5-community` (ADR-0005) has no replication
    mechanism at all in its OSS tier — Neo4j's only clustering (causal clustering) is
    Enterprise-only — so any design assuming uniform cross-region replication across all six
    stateful dependencies isn't buildable on what this repo actually runs. Every other store
    (PostgreSQL streaming/logical replication, OpenSearch cross-cluster replication, MinIO site
    replication, RabbitMQ federation/shovel, Redis replica sets) has a real native OSS path; Neo4j
    doesn't, short of an Enterprise/Aura licensing decision this ADR explicitly defers rather than
    makes on the repo's behalf.
- Loki log shipping (ROADMAP Phase 5, DEVOPS_SPEC §8) — closes the one gap the OpenTelemetry work
  left open:
  - `pino-logger.service.ts`: a second `pino` transport (`pino-loki`), on once `LOKI_URL` names a
    real instance (`loki.config.ts`, same on-by-config pattern `otel.config.ts` uses for tracing).
    Pushed directly from the app over HTTP rather than a container-log-tailing agent (Promtail,
    Grafana Alloy) — deliberately, since the API runs on the _host_ in local dev, not in this
    compose file, so a log-tailing agent watching containers would never see it; a push-based
    transport works identically whether the process is on a host or in a container.
    `requestId`/`traceId` stay in the log line body, never a Loki label — a per-request-unique value
    becoming an index label is exactly the high-cardinality mistake Loki's docs warn against.
    Immediate send (`batching: false`), not the client's 5s-batch default — a batch still buffered
    in memory on an ungraceful shutdown is exactly the last few seconds of logs an incident
    investigation needs most. `silenceErrors: true` — a Loki outage must never take the API down
    with it, the same fail-soft convention every other optional dependency in this app follows.
  - `infrastructure/monitoring/loki/loki-config.yaml` + a `loki` service in `docker-compose.yml`'s
    `monitoring` profile, port 3100 published to the host for exactly the push-from-host reason
    above. Grafana's Loki datasource carries a `derivedFields` entry matching `"traceId":"..."` in a
    log line and linking straight to that trace in Tempo — click a log line, land on its trace. The
    `api-overview.json` dashboard gained a fifth panel: recent logs, filtered to the API's own.
  - Verified with a real loopback HTTP server standing in for Loki (`create-pino-logger.spec.ts`) —
    asserts an actual POST to `/loki/api/v1/push` arrives carrying the log message, not just that
    constructing the logger doesn't throw. The same "verify against something real" approach
    `telemetry.spec.ts` used for the Prometheus exporter.
  - Documented gap, not faked: only the API's own logs ship this way. The other containerized
    dependencies (Postgres, Redis, RabbitMQ, Neo4j, Qdrant, OpenSearch, MinIO, Keycloak, and the
    observability stack's own containers) have no log-shipping path at all — a Promtail/Alloy job on
    Docker's container discovery would cover those, and is real, separate, not-yet-scoped work.
- Kubernetes worker Deployment (ROADMAP Phase 5, DEVOPS_SPEC §3) — closes the "second bootstrap file
  with no HTTP listener" gap the Kubernetes PR left open:
  - `apps/backend/src/main-worker.ts`: a new entrypoint bootstrapping the exact same `AppModule`
    `main.ts` does, via `NestFactory.createApplicationContext` instead of `.create()` — no HTTP
    adapter, so no REST routes register at all, but every `@Processor` in the module tree still gets
    instantiated and starts consuming. A bare `node:http` server (not Nest's HTTP adapter, which
    would also wire up every REST controller in `AppModule`) serves `/metrics` and `/healthz` —
    reusing `telemetry.metricsHandler` unchanged, since it was already framework-agnostic
    (`main.ts`'s own Express-adapter cast comment says as much).
  - `infrastructure/kubernetes/base/backend/worker-{deployment,service,hpa,networkpolicy, serviceaccount}.yaml`:
    same image as `api`, only the container `command` differs (`dist/main-worker.js`). BullMQ
    consumers on one queue name are safe to run concurrently by design (Redis-backed per-job
    locking) — `worker` is _additional_, independently scalable capacity, not a replacement for
    `api`'s own in-process processing, which keeps running exactly as before. Both overlays gained
    matching replica/HPA patches for `worker` (staging: 1 replica, HPA 1-2; production: 2 replicas,
    HPA 2-8).
  - Verified for real, not just typechecked: built and ran the compiled `dist/main-worker.js`
    directly (no live Redis/Postgres/etc. — the app's existing fail-soft behavior), confirmed
    `/healthz` and `/metrics` both respond correctly. Separately confirmed the noisy `ECONNREFUSED`
    reconnect logging seen when Redis is unavailable is pre-existing behavior of `main.ts` too
    (booted it the same way for comparison) — not a regression this introduced.
  - Documented, not faked: every feature module still bundles its HTTP controller and its workers in
    one Nest module (`task.module.ts` is typical), so `worker` boots the _entire_ module graph
    rather than a worker-only subset — the controller classes are instantiated as inert DI
    providers, harmless without an HTTP adapter, but not the fully clean split a real
    HTTP-only/worker-only module restructuring would be. That's materially larger,
    BACKEND_SPEC-level work, named explicitly in `main-worker.ts`'s own header comment rather than
    silently presented as done.
- k6 load tests wired into CI (ROADMAP Phase 5, TESTING_SPEC §9: `tag.v --> LOAD[k6 soak]`) — the
  first thing in this whole session actually verified against a real, live, fully-booted stack
  instead of a mock server or a syntax check, which is exactly why it surfaced this many real,
  previously-unexercised bugs:
  - `.github/workflows/release.yml`: a new `load-test` job boots Postgres, Redis, RabbitMQ, Neo4j,
    Qdrant, OpenSearch, MinIO, and Keycloak as GitHub Actions `services:` (same images/users/
    passwords as `docker-compose.yml`, so `tests/load/*.ts` need zero `-e` overrides), runs
    `prisma migrate deploy` + `db:seed`, imports the Keycloak realm via its own Admin REST API
    (`POST /admin/realms` — service containers start before `actions/checkout`, so
    `--import-realm`'s file-based approach can't be used here), builds and starts the real API, then
    runs `k6 run tests/load/soak.ts`. The `release` job now `needs: load-test` and is gated to
    `if: startsWith(github.ref, 'refs/tags/')`; the workflow also gained `workflow_dispatch` so
    `load-test` can be exercised on demand against any branch without cutting a real tag.
  - Along the way, root-caused and fixed real bugs nothing had ever exercised end-to-end before:
    - `infrastructure/kubernetes/base/keycloak/realm.json` had three separate schema mismatches
      against Keycloak 24's actual `RealmRepresentation`: a `refreshTokenReuseMinutes` field that
      doesn't exist, `defaultClientScopes`/`optionalClientScopes` used at the realm level (those
      names are only valid on a client — the realm-level equivalents are
      `defaultDefaultClientScopes`/`defaultOptionalClientScopes`), and realm roles defined in
      lowercase (`owner`, `manager`, `viewer`) while `authorization.service.ts`'s `ROLE_RANK` map is
      keyed by the Prisma `Role` enum's actual uppercase casing — the mismatch silently made every
      role check fail closed. Also added an `oidc-audience-mapper` (tokens never carried
      `aud: smb-copilot-api`, so `JwtAuthGuard`'s audience check rejected every token) and escaped
      the dot in `org.role`'s `claim.name` (unescaped, Keycloak treats a `.` as a nested-JSON-path
      separator, so the claim arrived as `{"org":{"role":...}}` instead of the flat `"org.role"` key
      `jwt-auth.guard.ts` actually reads) — confirmed by decoding a real issued token, not assumed.
    - `apps/backend/src/modules/auth/auth.module.ts`: `AUTH_JWKS` was declared in `providers` and
      its factory ran correctly (confirmed with a temporary debug log), but was never added to
      `exports` — `@Global()` only makes a module's _exported_ providers available elsewhere;
      `JwtAuthGuard`'s `@Optional() @Inject(AUTH_JWKS)` resolved to `undefined` for any guard
      instantiated through a different module's own container, i.e. every real controller outside
      `AuthModule` itself. Every authenticated endpoint 401'd with "Authentication is not
      configured" regardless of `AUTH_JWKS_URL` being set correctly.
    - `apps/backend/src/modules/invoices/invoice.service.ts`: `insertInvoice` numbered invoices by
      counting existing rows for the org/year, then retried up to 5 times on a unique-constraint
      collision. Under the soak test's 200 concurrent VUs, many requests read the same count before
      any of them committed, generating the same number repeatedly — 5 retries wasn't enough to
      absorb real contention (~33% of `CreateInvoice` calls failed). Replaced counting with a new
      `InvoiceNumberCounter` model (`prisma/schema.prisma`,
      `prisma/migrations/20260917080000_add_invoice_number_counters/`) and — after a `tx.upsert()`
      with `increment` turned out to _not_ be atomic either (the same collision recurred) — a raw
      `INSERT ... ON CONFLICT (organization_id, year) DO UPDATE SET value = value + 1 RETURNING value`
      via `tx.$queryRaw`, matching `prisma.service.ts`'s own existing raw-query convention. Atomic
      at the Postgres engine level regardless of what any ORM layer does above it. The
      now-provably-unreachable collision-retry loop (and `INVOICE_NUMBER_MAX_ATTEMPTS`,
      `isUniqueViolation`) was removed rather than kept as dead code.
    - `apps/backend/prisma/seed.ts`: seeded a hardcoded `"INV-2026-0001"` invoice directly,
      bypassing the new counter entirely. Every fresh run started the counter at 0, so the very
      first real `CreateInvoice` collided with that seeded row — and because the counter increment
      lives in the same transaction as the invoice insert, the failed create rolled back its own
      increment too, so every subsequent request hit the exact same collision, forever. Seeded
      `InvoiceNumberCounter` for `(org, 2026)` to `value: 1` alongside the invoice, and seeded
      `manager@`/`viewer@` as real users + org members (previously only `owner@` was seeded, even
      though the k6 scripts log in as all three by design). Both of the above were caught only
      because a full 30-minute soak run was actually executed against a real, freshly-migrated
      database — nothing short of that would have found either.
    - `tests/load/lib/{config,auth,workload}.ts`: after every backend fix above, `CreateInvoice`
      _still_ failed for roughly a third of requests — this one wasn't a bug at all. k6 picks one of
      the three demo users at random per VU and caches that choice for the whole token lifetime
      (long enough to cover an entire test run); any VU that logged in as `viewer@` then correctly
      got 403 "Insufficient role for this operation" on every `CreateInvoice` attempt for the rest
      of the run (`POST /invoices` requires OWNER/ADMIN/MANAGER/AGENT, per `invoice.controller.ts`'s
      `@RequireRoles`) — a real viewer's UI would never even show that action. Added a `role` field
      to each demo user (`config.ts`), exposed `getCurrentRole()` from `auth.ts`, and made
      `createInvoice()` fall back to `getDashboardSummary()` for a VIEWER session, the same pattern
      `search()` already uses for a different kind of expected degradation.
  - Verified for real: a full 30-minute, 200-VU `k6 run tests/load/soak.ts` against the CI job above
    passes at 100% — `checks_succeeded: 168167 out of 168167`, `http_req_failed: 0.00%`, p95 request
    duration 7.69ms (well under the 800ms threshold). Every fix was independently re-verified this
    same way, not just reasoned about — several early "fixes" in this list turned out to be real but
    insufficient on their own, and only re-running the actual test caught that.
- PostgreSQL WAL archiving + PITR (ROADMAP Phase 5, DEVOPS_SPEC §9) — closes the biggest remaining
  backup/DR gap: real RPO was "since the last nightly `pg_dump`," not the 5-minute target
  DEVOPS_SPEC §9 already documented:
  - `infrastructure/kubernetes/base/infrastructure/postgres.yaml`: a new `fetch-walg` initContainer
    downloads a pinned, checksum-verified `wal-g` v3.0.9 binary (Ubuntu 22.04 build — `wal-g` ships
    no Alpine/musl build, verified by downloading the real binary and inspecting it with
    `objdump -T`: its highest required symbol is `GLIBC_2.34`) into a shared `emptyDir`. Switched
    both the `postgres` container and `docker-compose.yml`'s `postgres` service from
    `postgres:16-alpine` to `postgres:16.15-bookworm` (glibc-based; verified via the Docker Hub
    registry API that this tag also has no `USER` directive, matching the existing `run-as-non-root`
    nosemgrep suppression) so the fetched binary can actually run. The `postgres` container now sets
    `wal_level=replica`, `archive_mode=on`, and `archive_command=/walg-bin/wal-g wal-push %p`,
    continuously shipping every completed WAL segment to the `smb-copilot-backups` MinIO bucket. A
    new `wal-backup` sidecar container in the same pod runs `wal-g backup-push` once a day — a
    separate CronJob couldn't do this, since the StatefulSet's PVC is `ReadWriteOnce` and can't be
    mounted by a second pod. The nightly `pg_dump` CronJob is unchanged and still ships, as a
    logical, portable, independent-of-wal-g backup.
  - `infrastructure/devops/incident.md`: PostgreSQL's RTO/RPO row now reads RPO <= 5m (was <= 24h);
    added a "Point-in-time recovery" procedure (`wal-g backup-list`/`wal-show`, wipe `$PGDATA`,
    `backup-fetch`, then a `recovery.signal` + `restore_command` + `recovery_target_time` config
    driving PostgreSQL's own recovery mode) alongside the existing logical `pg_restore` path. The
    tricky nested shell-quoting in that procedure (a single-quoted heredoc value inside an outer
    single-quoted `sh -c '...'`) was executed for real, twice, to confirm it produces the intended
    `postgresql.auto.conf` before it shipped in the doc.
  - Documented, not faked: no Docker or live Kubernetes cluster was available while building this,
    so the mechanism is verified against `wal-g`'s own documented env vars and commands
    (`docs/PostgreSQL.md`, `docs/STORAGES.md`) and real `kustomize build` output, but never
    exercised end-to-end — no WAL segment has actually been archived, no base backup taken, and no
    restore performed. `incident.md`'s "Known gaps" section says so explicitly, and names the
    concrete next step: do exactly that once, against a disposable cluster, before relying on it in
    a real incident.
- OpenSearch S3 snapshot repository (ROADMAP Phase 5, DEVOPS_SPEC §9) — closes the "snapshots aren't
  off-cluster" gap: OpenSearch's nightly snapshot previously landed on its own in-cluster PVC (an
  `fs`-type repository), which protects against index corruption but not against losing that PVC or
  node:
  - `infrastructure/kubernetes/base/infrastructure/opensearch.yaml`: a new `fetch-s3-plugin`
    initContainer runs `opensearch-plugin install --batch repository-s3` against the exact same
    `opensearchproject/opensearch:2.11.0` image the main container uses (plugin binaries are
    version-pinned to the distribution) and copies the installed plugin directory into a shared
    `emptyDir`. A second `build-opensearch-keystore` initContainer creates an OpenSearch keystore
    and seeds it with `s3.client.default.access_key`/`secret_key` — the S3 plugin reads credentials
    from OpenSearch's own encrypted keystore file, not plain env vars or `opensearch.yml`, per
    OpenSearch's own docs — and copies just that one file into a second shared `emptyDir`, mounted
    into the main container via `subPath` rather than replacing its whole `config/` directory. The
    main container gained the matching `s3.client.default.*` settings (`endpoint: minio:9000`,
    `protocol: http`, `path_style_access: true`, `region`) and `AWS_EC2_METADATA_DISABLED=true`
    (recommended for any non-AWS S3 endpoint). The old `path.repo` setting and the now-unnecessary
    `snapshots` PVC (`volumeClaimTemplates`) were removed.
  - `infrastructure/kubernetes/base/backup/opensearch-backup-cronjob.yaml` +
    `backup-scripts-configmap.yaml`'s `opensearch-backup.sh`: the CronJob gained the same
    `fetch-mc`-initContainer pattern `postgres-backup-cronjob.yaml` already uses, and the script now
    registers an `s3_backup` repository (bucket = `STORAGE_BACKUP_BUCKET`, same
    `smb-copilot-backups` bucket every other backup job writes to) instead of the old `fs_backup`
    one, with `mc mb --ignore-existing` as a self-healing guard against the bucket not existing yet
    (the S3 plugin won't create it).
  - `infrastructure/devops/incident.md`: OpenSearch's RTO/RPO footnote and restore procedure now
    reference the `s3_backup` repository instead of `fs_backup`.
  - Verified for real, not faked: downloaded the actual `repository-s3-2.11.0.zip` from
    `artifacts.opensearch.org` and confirmed its sha512 matches the published checksum before wiring
    this up; `kustomize build` against base + both overlays all succeed; every
    `s3.client.default.*`/keystore setting and command matches OpenSearch's own snapshot-restore
    docs, fetched directly rather than assumed; both new initContainer shell scripts and the
    rewritten `opensearch-backup.sh` (including its JSON repository-registration body) were
    syntax-checked, and the JSON body's shell substitution was tested to confirm it produces valid
    JSON.
  - Documented, not faked: no Docker or live Kubernetes cluster was available while building this,
    so installing the plugin, loading the keystore, registering the repository, taking a snapshot,
    and restoring it has never run end-to-end. `incident.md`'s "Known gaps" section says so
    explicitly and names the concrete next step: do exactly that once, against a disposable cluster,
    before relying on it in a real incident.
- Clean HTTP/worker module split (ROADMAP Phase 5, DEVOPS_SPEC §3) — closes the gap
  `main-worker.ts`'s own header comment named since the Kubernetes worker Deployment PR: every
  feature module that bundled an HTTP controller with its BullMQ workers in one module
  (`task.module.ts` was the typical example) made `worker` instantiate every controller in the app
  as an inert DI provider, just because `createApplicationContext` has no HTTP adapter to route them
  to:
  - Split ten feature modules — `appointments`, `conversations`, `insights`, `inventory`,
    `invoices`, `notifications`, `purchasing`, `search`, `tasks`, `workflows` — into an HTTP half
    (`<feature>.module.ts`, unchanged name/exports, so nothing importing it for its `Service` broke)
    and a new worker half (`<feature>-worker.module.ts`, providing just the `@Processor` class(es)
    plus whatever each one's constructor actually needs — traced individually per worker, not
    assumed from the old module's `imports`).
  - Also split two shared modules whose own controller would otherwise have leaked into the worker
    transitively: `chat.module.ts`'s `LlmProvider` moved into a new standalone `llm.module.ts` (four
    other modules' workers imported `ChatModule` purely for `LlmProvider`, which also pulled in
    `ChatController` and the whole of `SearchModule`); `storage.module.ts`'s `StorageController`
    moved into a new `storage-http.module.ts` (`search.worker.ts` needs the global `StorageService`,
    which used to mean instantiating `StorageController` too). `search.module.ts` itself split the
    same way as the ten feature modules, into an HTTP half and `search-worker.module.ts`; the
    OpenSearch-client construction that both now need was factored into one shared
    `createSearchService()` (`search.config.ts`) so the two independent module graphs can't drift on
    how it's built.
  - New `apps/backend/src/worker-app.module.ts`: the root module `main-worker.ts` now bootstraps
    instead of `AppModule` — imports only the ten worker halves, `LlmModule`, and shared infra
    (`Database`, `Events`, `Queue`, `Storage`, `Embeddings`, `Graph`, `Core`). `AuthModule` is
    deliberately absent: nothing under any worker half depends on it (RBAC is an
    `ExecutionContext.switchToHttp()`-scoped concern), so the worker process no longer fetches
    Keycloak's JWKS at all. `HealthModule`/`OpenApiModule` and every pure-HTTP feature module
    (`chat`, `connectors`, `dashboard`, `forecasting`, `health`, `ingestion`, `knowledge`,
    `openapi`) are equally absent — traced their exports against every worker file first to confirm
    none are actually depended on. `DatabaseModule` (whose only _other_ importer is `HealthModule`,
    now absent) is imported directly here instead, since `PrismaService` is needed everywhere and
    nothing else in this tree would otherwise load it.
  - Verified for real, twice over: the existing `test/app.e2e-spec.ts` (boots the real `AppModule`
    through Nest's `TestingModule`) passes unchanged — every REST route, every 401 check — proving
    the HTTP-side split broke nothing. Separately, built and ran the compiled `dist/main-worker.js`
    directly and read its own boot log: only `*WorkerModule`s, `LlmModule`, and the shared infra
    above ever say "dependencies initialized" — no `AuthModule`, `HealthModule`, `OpenApiModule`,
    `ChatModule`, or any other HTTP-only module appears, and `/healthz`/`/metrics` both respond
    correctly. Full backend test suite (555 tests), typecheck, and lint all pass unchanged.
- WhatsApp outbound notification delivery via Twilio (ROADMAP Phase 3, API_SPEC §11.14) — the gap
  `notification.constants.ts` named as deferred (no approved WhatsApp Business sender to test
  against): Twilio's free WhatsApp Sandbox turns out to be a real, unapproved-sender-free way to
  exercise this for real, so it's no longer a stub:
  - `User.whatsapp` (new nullable column, migration `20260918090000_add_user_whatsapp`) — the
    outbound recipient number; only `Customer.whatsapp` (inbound, connectors) existed before. No
    self-service way to set it yet (no user-profile endpoint exists at all), so it's seed/DB-set
    only for now (`prisma/seed.ts`'s `DEMO_OWNER_WHATSAPP` env var).
  - `whatsapp.config.ts`/`whatsapp.provider.ts`: `WhatsAppProviderConfig`/`WhatsAppProvider`,
    mirroring `email.config.ts`/`email.provider.ts` exactly — fail-soft without
    `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM`, injects an already-constructed
    `Twilio` client via DI, adds the `whatsapp:` channel prefix Twilio's API requires on both
    addresses.
  - `notification.delivery.worker.ts`: now branches on `Notification.kind` — `WHATSAPP` rows send
    via `WhatsAppProvider` to `User.whatsapp`; `IN_APP`/`EMAIL` rows keep sending via
    `EmailProvider` to `User.email`, unchanged from before. Purely additive: every current
    alert-creating worker (invoice-overdue, inventory-reorder, appointment-reminder,
    purchase-recommendation, task-auto-completion, workflow-engine) still creates `IN_APP` rows, so
    no existing delivery behavior changed. `WhatsApp`-kind delivery is real and Sandbox-tested but
    dormant until some caller opts an alert into `NotificationKind.WHATSAPP` — deliberately left to
    a future change, same as `EMAIL`-kind rows have always been (nothing creates those either).
  - `notification-worker.module.ts`: `WhatsAppProvider` built the same way `EmailProvider` is — a
    factory reading `whatsappProviderConfig()`, exported alongside it.
  - New `WHATSAPP_UNAVAILABLE` error code (`error-contract.ts`), `twilio` SDK dependency,
    `.env.example`/`env.validation.ts` entries for the three Twilio env vars.
  - No delivery-status webhook yet — Twilio's own delivery/read receipts aren't consumed, so
    `deliveredAt` reflects only "the send API call succeeded." Documented as a follow-up in API_SPEC
    §11.14, not built here.
  - Verified for real: full backend test suite (566 tests, +11 new — `whatsapp.config.spec.ts`,
    `whatsapp.provider.spec.ts`, 4 new WHATSAPP-kind cases in
    `notification.delivery.worker.spec.ts`), typecheck, lint, and the e2e suite (24/24) all pass.
    Built the real backend and booted the compiled `dist/main.js` twice — once with Twilio env vars
    unset (fail-soft, `NotificationsWorkerModule` still initializes, app still starts) and once with
    fake Twilio credentials set (the `Twilio` client constructs without throwing, app still starts)
    — confirming this environment can reach `api.twilio.com` directly (a live, unauthenticated
    request returned a real 401, not a network error), so a real send/receive round trip against the
    Sandbox is possible the moment real credentials are supplied.

### Changed

- Design system promoted from Draft to Ratified (`docs/specifications/DESIGN_SYSTEM.md`)
- Design tokens are now AA-verified and enforced by a CI contrast gate

### Fixed

- `health.service.ts`: `GET /api/v1/health` reported every dependency but Postgres as `configured`
  unconditionally — each ternary checked `hasUrl(...)` but returned the same literal string
  (`'configured'`) on both branches, so the check never actually influenced the result. Found by
  booting the compiled API with zero env vars set and noticing all 8 read `configured` regardless.
  Added a real `not_configured` status (a normal, expected state for an optional dependency — not a
  degradation) and fixed every ternary, including Postgres's own default (previously hardcoded to
  `'configured'` before its real probe result could override it). The existing test only asserted on
  Postgres, which is why this went uncaught; added coverage for the `configured`/`not_configured`
  distinction on another dependency (`redis`), and re-verified live against a real running instance
  both with and without `REDIS_URL` set.
- `all-exceptions.filter.ts`: every Nest-native `HttpException` (guards' `UnauthorizedException`,
  unmatched-route `NotFoundException`, `ValidationPipe`'s `BadRequestException`, ...) had its
  response body double-wrapped as `error.details.details` instead of `error.details`, deviating from
  the documented envelope (API_SPEC §9: `"details": {}`, no nested `details` key). Found by curling
  a live 401/404/400 against the compiled API. `ApiError`-thrown errors were unaffected — every
  existing call site leaves `details` unset (defaults to `{}`), so the bug was invisible to the only
  path anyone had tested. No spec file existed for this filter at all; added one
  (`all-exceptions.filter.spec.ts`) covering both exception paths, `ApiError`, a generic `Error`,
  and request-id propagation (including the `"unknown"` fallback for a request that fails to parse
  before the request-id middleware ever runs — confirmed live to be the _only_ case that falls back,
  not a second bug). Re-verified live against a real running instance.
- `openapi-document.ts`: the OpenAPI document's top-level `servers` and `tags` arrays were both
  empty — `DocumentBuilder` never called `.addServer(...)` or `.addTag(...)`, despite API_SPEC §10
  documenting the convention as "server URL, global BearerAuth, tags matching module names."
  `BearerAuth` was there; the other two weren't. Every controller already carries a real
  `@ApiTags(...)` matching its module name, so operation-level tags were never missing — Swagger UI
  would still group correctly, just without top-level descriptions. Found while continuing the
  live-testing pass: curled `/api/v1/openapi.json` and noticed both arrays were empty. Added a
  server URL (from `APP_URL`, matching every other env-driven optional-config convention in this
  app) and a description for each of the 20 real tags in use, sourced from each controller's own doc
  comment rather than newly invented copy. The existing e2e test only asserted
  `res.body.openapi === '3.1.0'`; extended it to assert `servers` is non-empty and that every tag an
  operation actually uses has a matching top-level declaration — the exact assertion that would have
  caught this the first time.
- `app.module.ts`: the HTTP/worker module split (previous changelog entry) imported only the HTTP
  half of all ten split feature modules, never their `*-worker.module.ts` sibling — so `api`
  (`main.ts`) lost every one of its own in-process `@Processor`s (appointment reminders, invoice
  recurrence/overdue, inventory reorder, notification delivery, purchase recommendations, search
  indexing, task planning/auto-completion, workflow engine, conversation embedding/summary),
  contradicting `infrastructure/kubernetes/README.md`'s own claim, in the same PR, that `worker` is
  "additional capacity... doesn't replace api's own processing." Local dev was hit hardest: `start`/
  `start:dev` only ever boot `main.ts`, and no compose service or script also runs `main-worker.ts`,
  so every one of these ten job families silently processed zero jobs. Found by a `/code-review`
  pass tracing the actual module-import graph rather than trusting the diff. Restored by importing
  every `*-worker.module.ts` into `app.module.ts` alongside its HTTP-half sibling, so `api` keeps
  doing in-process processing exactly as documented, while `worker-app.module.ts` remains the one
  importing worker halves only. No test caught this — the e2e suite only ever asserted on HTTP
  routes — so added one that resolves all thirteen worker provider classes straight out of
  `AppModule` (`test/app.e2e-spec.ts`); confirmed it fails against the pre-fix module graph before
  confirming it passes against the fix. Re-verified live: built and ran the compiled `dist/main.js`
  directly and confirmed via its own boot log that all ten `*WorkerModule`s now initialize; re-ran
  `dist/main-worker.js` too and confirmed its boot log is unchanged (still only worker modules and
  shared infra, no `@Controller`).

## [0.1.0] - 2026-08-02

### Added

- Design system foundation (`packages/ui`):
  - TypeScript token source of truth (colors, typography, spacing, radii, elevation, motion,
    breakpoints) with JSDoc
  - WCAG 2.1 contrast utilities and a CI contrast gate (fails under AA)
  - Platform generators producing `generated/tokens.css`, `generated/tokens.dart` (Flutter), and
    `generated/tokens.json`
  - Unit tests (node:test) for token integrity, 4px grid, radii, and contrast
