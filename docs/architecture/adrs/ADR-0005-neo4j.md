# ADR-0005: Neo4j for the knowledge graph

- Status: Accepted
- Date: 2026-08-02
- Owner: AI Team
- Deciders: Backend Team

## Context

The product's differentiator is answering questions about *relationships*: which
documents mention a product, who is expert in a topic, which policies apply to a
given operation, how customers relate to products/orders. Relational modeling of
these deep, variable-depth relationships is painful. Options: model relationships
in PostgreSQL, use GraphQL-style JSON blobs, or adopt a graph database.

## Decision

Use **Neo4j** as the knowledge-graph store for entities, relationships, and
expertise discovery. It complements PostgreSQL (ATS record) and Qdrant (vectors).
Not the system of record for business data; a derived read-model plus
write-through for knowledge links.

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| PostgreSQL recursive CTEs | Expensive at depth; poor for many-hop "who knows who" |
| Amazon Neptune | Managed, but managed lock + cost; less local tooling |
| ArangoDB | Multi-model; smaller ecosystem vs Neo4j |

## Pros

- Native graph traversal, relationship-aware queries.
- Great for path queries (expertise discovery, document linking).
- Cypher readability and developer velocity.

## Cons

- Another system to operate (backups, HA).
- Eventual consistency with relational store requires discipline (outbox pattern).
- Cost grows with relationship volume.

## Consequences

- Models live in `apps/backend` graph service; constraints are unique IDs.
- Write-through triggered by domain events from PostgreSQL (ingestion pipeline).
- Read via GraphRAG in AI layer for expanded context.

## References

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
- [AI_ARCHITECTURE](../specifications/AI_ARCHITECTURE.md)