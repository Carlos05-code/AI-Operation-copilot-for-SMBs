# Getting Started (DevOps)

How to get a local environment running.

## 0. Prerequisites

| Tool           | Version | Why                  |
| -------------- | ------- | -------------------- |
| Docker         | ≥ 24    | containers           |
| Docker Compose | ≥ 2.x   | local stack          |
| pnpm           | ≥ 9     | monorepo             |
| Node.js        | ≥ 20    | backend              |
| Flutter        | ≥ 3.24  | mobile               |
| Make           | any     | convenience commands |

## 1. Install

```bash
git clone git@github.com:Carlos05-code/AI-Operation-copilot-for-SMBs.git
cd AI-Operation-copilot-for-SMBs
make setup
```

## 2. Start infrastructure

```bash
cp .env.example .env        # fill in secrets (local dev only)
make infra-up
docker compose ps           # all healthy
```

This starts: PostgreSQL, Redis, RabbitMQ, Neo4j, Qdrant, OpenSearch, MinIO, Keycloak.

## 3. Migrate & seed

```bash
make db-generate
make db-migrate
make db-seed
```

## 4. Run API

```bash
make api-dev      # http://localhost:3000/api/v1/health
```

## 5. Run mobile app

```bash
make mobile-dev
```

## 6. Open the dashboard

```
PostgreSQL  http://localhost:5432
RabbitMQ   http://localhost:15672 (ops / changeme)
Neo4j      http://localhost:7474
MinIO      http://localhost:9001
Keycloak   http://localhost:8080
OpenSearch http://localhost:9200
```

Keycloak admin console: `admin / changeme` (see `KEYCLOAK_ADMIN_PASSWORD`). The `smb-copilot` realm
is imported automatically from `infrastructure/keycloak/realm.json` on first boot and provides demo
users `owner@`/`manager@`/`viewer@acme-demo.local` (password `changeme`), roles
`owner/admin/manager/agent/viewer`, and the `org_id` + `org.role` token claims the API validates
(see `docs/security/authentication.md`).

Object storage is exposed via presigned URLs only: the API never proxies file bytes. Set
`STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`/`STORAGE_BUCKET` (see `.env.example`)
and use `POST /api/v1/storage/uploads/presign` / `GET /api/v1/storage/objects?key=...` to obtain
short-lived MinIO URLs; without those env vars the endpoints return `STORAGE_UNAVAILABLE` (503).

Embeddings are produced by an OpenAI-compatible endpoint (`EMBEDDINGS_API_URL`/`EMBEDDINGS_API_KEY`,
e.g. BGE-M3 behind vLLM) and stored in Qdrant (`QDRANT_URL`/`QDRANT_API_KEY`). An `ai-jobs` BullMQ
worker consumes `document.ingested` jobs: it chunks the cleaned text (~384 tokens with 64-token
overlap), embeds in batches, and upserts vectors into the org's `doc_chunks_{org}` collection (see
`DATABASE_SPEC` §5). Without those env vars the worker skips embedding jobs and the API keeps
working (fail-soft).

Keyword search uses OpenSearch (`OPENSEARCH_URL`/`OPENSEARCH_USERNAME`/`OPENSEARCH_PASSWORD`): a
`search-jobs` BullMQ worker consumes `document.index` jobs and indexes chunks into the org's
`search_{org}` index. `POST /api/v1/search` fuses Qdrant + OpenSearch results with RRF; if either
store is unconfigured the endpoint degrades to the available one and only fails with
`SEARCH_UNAVAILABLE` (503) when nothing is configured.

The knowledge graph uses Neo4j (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`/`NEO4J_DATABASE`): a
`graph-jobs` BullMQ worker extracts entities (deterministic, LLM-free) from each chunk and merges
the document/chunk/entity subgraph (`DATABASE_SPEC` §4). Hybrid search then expands the query's
entities through the graph, so results mentioning the same people/companies rank higher. Without
`NEO4J_URI` the graph stage is skipped and search still works.

Grounded chat (`POST /api/v1/chat`) uses an OpenAI-compatible chat completions endpoint
(`LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`, e.g. OpenAI, Azure OpenAI, or a local vLLM gateway). It
retrieves context via the hybrid search above, sends the `qa.document.v1` prompt, and returns the
answer with validated citations, confidence, and a grounding verdict (AI_ARCHITECTURE §6–§10). When
retrieval finds nothing, the LLM is not called and a disclaimer is returned; without `LLM_API_URL`
the endpoint fails with `LLM_UNAVAILABLE` (503) — chat is the one surface that cannot degrade, since
answering requires a model.

Customer conversations are ingested via `POST /api/v1/conversations` (DATABASE_SPEC §3): threads and
messages land in PostgreSQL (idempotent via external ids), and the `ai-jobs` worker embeds message
bodies into the `conversation_{org}` Qdrant collection for retrieval alongside documents (§5). No
extra env vars are needed beyond `QDRANT_URL`/`EMBEDDINGS_*`; without them ingestion still persists
but the embedding job is skipped (fail-soft).

Browse the knowledge base with `GET /api/v1/knowledge` / `GET /api/v1/knowledge/:id` — an org-scoped
read-only surface over the INDEXED documents registry (API_SPEC §11.7).

Conversations can be browsed (`GET /api/v1/conversations[/:id]`) and summarized:
`POST /api/v1/conversations/:id/summarize` schedules an LLM handoff summary on the `summary-jobs`
queue (API_SPEC §11.8). Without `LLM_API_URL` the job is skipped, never failing the request.

Channel connectors translate native payloads into conversations:
`POST /api/v1/connectors/:channel/inbound` with `whatsapp` / `email` / `slack` payloads (API_SPEC
§11.9) — customers are resolved by channel identity (`Customer.whatsapp` / `Customer.email`) and
provisioned when unknown.

## Troubleshooting

- Port conflicts: edit `docker-compose.yml` port mappings.
- Keycloak realm changes: edit `infrastructure/keycloak/realm.json`, then
  `docker compose up -d --force-recreate keycloak` (recreate the Keycloak volume to re-import).
- Use `make infra-down` / `make infra-down-volumes` to reset.

---

→ [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md) · [Compose file](../../docker-compose.yml)
