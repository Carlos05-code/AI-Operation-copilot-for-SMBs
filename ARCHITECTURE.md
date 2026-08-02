# Architecture

This document is the **entry point** for understanding the system architecture.
It links the deep-dive documentation. The authoritative specifications live in
[`docs/specifications/`](docs/specifications/) and decision records in
[`docs/architecture/adrs/`](docs/architecture/adrs/).

## System at a Glance

**AI Operations Copilot** is a multi-tenant, event-driven AI platform that helps
small and medium businesses automate back-office operations. It marries:

- **A relational core** (PostgreSQL) for the business of record.
- **A graph** (Neo4j) for knowledge relationships.
- **A vector store** (Qdrant) for semantic retrieval.
- **A full-text index** (OpenSearch) for hybrid search.
- **An AI layer** (LangGraph + provider-agnostic model gateway) for language work.
- **Work queues** (RabbitMQ / BullMQ) for asynchronous processing.
- **A Flutter client** for mobile/desktop/web surfaces.

### Logical Topology

```mermaid
flowchart TB
    subgraph SRC["Data Sources"]
        WA[WhatsApp]
        EM[Email]
        XL[Excel]
        DOC[Documents / PDFs]
CRM[CRM]
        AC[Accounting]
    end

    subgraph CORE["Ops Copilot Core"]
        API[API Gateway - NestJS]
        AI[AI Orchestrator - LangGraph]
        EVT[Event Bus - RabbitMQ]
        WRK[Workers - BullMQ]
    end

    subgraph DA[Data Layer]
        PG[(PostgreSQL ops)]
        NEO[(Neo4j knowledge)]
        VEC[(Qdrant vectors)]
        OS[(OpenSearch)]
        MIN[(MinIO objects)]
        RED[(Redis cache)]
    end

    WA --> API
    EM --> API
    XL --> API
    DOC --> API
    CRM --> API
    AC --> API

    API --> PG
    API --> EVT
    EVT --> WRK
    WRK --> MIN
    WRK --> NEO
    WRK --> VEC
    API --> RED
    API --> AI
    AI --> VEC
    VEC --> AI
    AI --> NEO
    NEO --> AI
    AI --> OS
```

## Container Diagram

```mermaid
C4Container
title Container diagram for AI Operations Copilot

Container(webapp, "Flutter App", "Dart, Riverpod, Dio", "Mobile, web, and desktop client surfaces")
Container(api, "API Gateway", "NestJS, TypeScript", "REST API, auth, orchestration")
Container(kb, "Knowledge Service", "NestJS", "Embeddings, ingestion, graph")
Container(ai, "AI Orchestrator", "LangGraph", "RAG, GraphRAG, planning")
ContainerDb(pg, "PostgreSQL", "Relational", "Business records: orgs, customers, inventory, sales, invoices")
ContainerDb(neo, "Neo4j", "Graph", "Knowledge graph of documents, entities, people, policies")
ContainerDb(vec, "Qdrant", "Vector", "Embeddings, semantic retrieval")
ContainerDb(redis, "Redis", "Cache", "Sessions, queues, rate limiting")
ContainerDb(os, "OpenSearch", "Full-text", "Hybrid search, log analytics")
Container(queue, "RabbitMQ", "Backend support", "Event bus and job scheduling")

Rel(webapp, api, "HTTPS/JSON")
Rel(api, kb, "gRPC/REST")
Rel(api, ai, "gRPC/REST")
Rel(kb, pg, "Data")
Rel(kb, neo, "Relationship")
Rel(kb, vec, "Embeddings")
Rel(api, os, "Search")
Rel(api, redis, "Cache")
Rel(api, queue, "Publish")
```

> Full interactive server diagrams and the C4 model are in
> [docs/architecture/](docs/architecture/) and
> [docs/diagrams/](docs/diagrams/).

## Key Principles

- **Clean Architecture** — domain core, independent of framework/database/AI/vendor.
- **Documentation-first** — every change updates related docs in the same PR.
- **Event-driven** — async communication via RabbitMQ where synchronous
  responses are not required.
- **Security by default** — RBAC, tenancy isolation, secrets management,
  prompt-injection defenses.
- **Twelve-factor** — declarative config, disposable processes, no local state.

## Layers and Ownership in the Codebase

```
apps/backend           NestJS API, domains, infra adapters
apps/mobile            Flutter app (feature-first)
packages/shared        Shared TS contracts used by backend + docs
packages/ui            Design system (design tokens, components)
packages/config        Runtime configuration & validation
infrastructure/        Docker/Kubernetes/monitoring definitions
```

## Where To Go Next

| Context | Read |
| ------- | ---- |
| Understand the product | [`docs/specifications/PROJECT_SPEC.md`](docs/specifications/PROJECT_SPEC.md) |
| Deep architecture | [`docs/specifications/ARCHITECTURE_SPEC.md`](docs/specifications/ARCHITECTURE_SPEC.md) |
| Data & schema | [`docs/specifications/DATABASE_SPEC.md`](docs/specifications/DATABASE_SPEC.md) |
| AI / RAG / GraphRAG | [`docs/specifications/AI_ARCHITECTURE.md`](docs/specifications/AI_ARCHITECTURE.md) |
| APIs | [`docs/specifications/API_SPEC.md`](docs/specifications/API_SPEC.md) |
| Security | [`docs/specifications/SECURITY_SPEC.md`](docs/specifications/SECURITY_SPEC.md) |
| Operations | [`docs/specifications/DEVOPS_SPEC.md`](docs/specifications/DEVOPS_SPEC.md) |
| Why this stack | [`docs/architecture/adrs/`](docs/architecture/adrs/) |
| Delivery plan | [`ROADMAP.md`](ROADMAP.md) |