# Knowledge Ingestion Flow

From raw upload to searchable, indexed knowledge.

```mermaid
flowchart LR
    U[User upload] --> API[API]
    API --> ST[Object store MinIO]
    API --> Q[RabinMQ]
    Q --> W[Worker]
    W --> EX[Extract: text / OCR]
    EX --> CL[Clean & normalize]
    CL --> CH[Chunk]
    CH --> EM[Embed BGE-M3]
    EM --> V[(Qdrant)]
    CH --> NE[Entity graph build]
    NE --> NO[(Neo4j)]
    CH --> KW[Tokenize]
    KW --> OS[(OpenSearch)]
    W --> EVT[emit indexed event]
```

## Read more

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
- [AI_ARCHITECTURE](../specifications/AI_ARCHITECTURE.md)