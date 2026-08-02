# ADR-0007: RabbitMQ as the event bus

- Status: Accepted
- Date: 2026-08-02
- Owner: Platform
- Deciders: Backend Team

## Context

Multiple async flows: ingestion → NLP → indexing; invoice events → notifications; scheduler →
workers. We need reliable, at-least-once delivery, multiple consumers (workers), optional routing,
and durability. Options: RabbitMQ, Apache Kafka, Redis pub/sub, Google Pub/Sub

## Decision

Use **RabbitMQ** as the primary event/message bus, with **BullMQ** on Redis for job scheduling and
queue processing where RabbitMQ doesn't provide native scheduler semantics.

- Exchange topology: fanout for domain-event fanout; queues for consumers.
- Outbox pattern ensures at-least-once.
- BullMQ for cron/retry-heavy jobs (OCR batches, weekly summaries).

## Alternatives

| Option        | Trade-off                                          |
| ------------- | -------------------------------------------------- |
| Kafka         | Heavy durability, log replay; more ops (a cluster) |
| Redis pub/sub | At-most-once, no durable consumers for major flows |
| SQS           | Cloud-bound (AWS); we want infra-portable          |

## Pros

- Durable, acknowledgements, dead-lettering out of box.
- Broad ecosystem + familiar ops.
- Works with outbox to guarantee at-least-once correctness.

## Cons

- RabbitMQ not a log; no replay for consumers.
- Additional broker to run/operate.

## Consequences

- All business events fan out through exchanges (`invoice.*`, `knowledge.*`, ...).
- Async components receive events; RabbitMQ failures surface into dead-letter alerts.
- BullMQ backs scheduler-style processing + retries.

## References

- [ThenEvent-driven design section in ARCHITECTURE_SPEC](../specifications/ARCHITECTURE_SPEC.md)
