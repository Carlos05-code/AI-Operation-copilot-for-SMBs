# ADR-0006: Qdrant as the vector database

- Status: Accepted
- Date: 2026-08-02
- Owner: AI Team
- Deciders: Backend/AI

## Context

Semantic search and RAG require a vector store that co-locates embeddings for
hybrid retrieval. Options: Qdrant, Pinecone, Weaviate, Milvus, pgvector.

## Decision

Use **Qdrant** as the vector database.

- Self-hosted or managed (drop-in), Rust-based, cosine distance, namespaced
  collections per org.
- Payload indexing allowed for tenancy-scoped retrieval.
- Primary embeddings: BGE-M3 (1024 dim), fallback OpenAI (as AI spec).

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| Pinecone (SaaS) | Managed but cost + data sovereignty issues; not fully self-hosted |
| Weaviate | Heavier, multi-model feature set we don't need yet |
| pgvector | Autonomy within Postgres but limited for large-scale + advanced filtering |
| Milvus | Powerful but heavier ops footprint |

## Pros

- Self-hostable (control data), strong performance, payload filters + resharding.
- Local hybrid search (dense + sparse) feasible with payload filtering.
- Aligns with Docker + K8s ops we already run (ADR-0009/0010).

## Cons

- Additional stateful service to run (backups, scaling).
- Requires explicit collection-per-org strategy.

## Consequences

- One collection per organization (`doc_chunks_<org>`) for tenant isolation.
- Embeds in the ingestion workers pipeline (AI_ARCHITECTURE §4).
- Retrieval fuses Qdrant + OpenSearch + Neo4j (RAG hybrid).

## References

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
- [AI_ARCHITECTURE](../specifications/AI_ARCHITECTURE.md)