# System Architecture Diagram

Full system context and container diagram for the AI Operations Copilot.

```mermaid
flowchart TB
    subgraph Clients
        App[Flutter App]
        Web[Dashboard Web UI]
    end

    subgraph Edge
        GW[API Gateway]
        IDP[Keycloak]
    end

    subgraph Persistence
        PG[(PostgreSQL)]
        NEO[(Neo4j)]
        QDR[(Qdrant)]
        OS[(OpenSearch)]
        MIN[(MinIO)]
        RED[(Redis)]
    end

    subgraph Messaging
        RMQ[(RabbitMQ)]
        BQ[BullMQ Workers]
    end

    subgraph AI
        ORCH[AI Orchestrator]
        LLM[LLM Providers]
        OCR[OCR / Extract]
    end

    App --> GW
    Web --> GW
    GW --> IDP
    GW --> PG
    GW --> RED
    GW --> RMQ
    GW --> AI
    ORCH --> LLM
    ORCH --> QDR
    ORCH --> NEO
    ORCH --> OS
    RMQ --> BQ
    BQ --> MIN
    BQ --> NEO
    BQ --> QDR
    OCR --> BQ
```

## Container Responsibilities

| Container                   | Responsibility                        |
| --------------------------- | ------------------------------------- |
| API Gateway                 | REST, auth, validation, orchestration |
| AI Orchestrator (LangGraph) | RAG, tool-calling, planning           |
| Knowledge Worker            | ingestion, embeddings, graph building |
| PostgreSQL                  | system of record (ACID)               |
| Neo4j                       | knowledge relationships               |
| Qdrant                      | vectors / embeddings                  |
| OpenSearch                  | full text + hybrid index              |
| MinIO                       | object storage (docs, exports)        |
| Redis                       | cache, sessions, queues, rate-limit   |

## Read more

- [Architecture spec](../specifications/ARCHITECTURE_SPEC.md)
- [ADR-0010 Kubernetes](../architecture/adrs/ADR-0010-kubernetes.md)
