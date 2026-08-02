# ADR-0012: OpenSearch for full-text search

- Status: Accepted
- Date: 2026-08-02
- Owner: Data
- Deciders: Data + AI Teams

## Context

We need full-text search (invoice numbers, keywords) and log aggregation. Options: Elasticsearch,
OpenSearch, Meilisearch, Solr.

## Decision

Use **OpenSearch** for:

1. Full-text (BM25) and hybrid search indexes over business/knowledge text.
2. Aggregations and reporting read models (with exports). (Log ingestion is handled by Loki per
   ADR-0011; OpenSearch focuses on search.)

Self-hostable, Apache-licensed alternative to Elasticsearch with the feature parity we need.

## Alternatives

| Option        | Trade-off                                              |
| ------------- | ------------------------------------------------------ |
| Elasticsearch | License (ELv2/SSPL) friction, otherwise near-identical |
| Meilisearch   | Simpler, but weaker analytics/aggregation              |
| Solr          | Mature, but heavier ops + less dynamic                 |

## Pros

- Full-text + fuzzy + aggregations in one system.
- Community and tools (managed by OpenSearch distro).
- Scales with shards/replication.

## Cons

- Another stateful service to run carefully (JVM).
- Security config (discovery, users) needs hardening.

## Consequences

- Per-org indices `search_<org>`; hybrid retrieval merges with Qdrant + Neo4j.
- OpenSearch snapshots to objects store (backups).
- Dashboards on OpenSearch for search/analytics features.

## References

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
