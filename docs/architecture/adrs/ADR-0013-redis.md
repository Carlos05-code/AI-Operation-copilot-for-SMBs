# ADR-0013: Redis for caching, queues, and rate limiting

- Status: Accepted
- Date: 2026-08-02
- Owner: Platform
- Deciders: Backend + SRE

## Context

We need a fast in-memory datastore for cache, short-lived sessions/state,
rate-limiting counters, locks, and queue backends (BullMQ). Options: Redis,
Memcached, Hazelcast, plain DB-based caching.

## Decision

Use **Redis** for:

- Cache-aside store (TTL-based) ahead of PostgreSQL/API reads.
- BullMQ queue instances (Redis-backed, supports retries/priorities).
- Rate limiting (sliding window / token bucket) for API abuse control.
- Distributed locks for long-running worker tasks.

Option: use Redis Cluster in production as data grows.

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| Memcached | Cache only; no queues/locks/rate-limit |
| Hazelcast | Distributed JVM grid, but heavier and overkill |
| In-DB caching | DB pressure, no rich TTL/move ops |

## Pros

- Single familiar primitives for cache, queues, locks, rate-limit.
- Low-latency, battle-tested; official Docker image.
- BullMQ tightly integrates with it for workers.

## Cons

- In-memory: persistent (AOF/RDB) plus eviction config required.
- Another service to operate.

## Consequences

- BullMQ registered queues (`invoice`, `embed`, `graph`, `notify`, ...) on Redis.
- Rate-limit middleware stores counters with TTL + headers (`X-RateLimit-*`).
- Distributed lock namespace for duplicated workers.

## References

- [DATABASE_SPEC](../specifications/DATABASE_SPEC.md)
- [BullMQ within BACKEND_SPEC](../specifications/BACKEND_SPEC.md)