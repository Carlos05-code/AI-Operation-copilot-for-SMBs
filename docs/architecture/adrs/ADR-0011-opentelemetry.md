# ADR-0011: OpenTelemetry for observability

- Status: Accepted
- Date: 2026-08-02
- Owner: Platform
- Deciders: SRE / Backend

## Context

We need a unified way to observe the whole system: distributed traces across
API → events → workers → AI, metrics for SLOs, and structured logs. Options:
vendor-specific SDKs, Jaeger + Prometheus + Fluentd (manual), OpenTelemetry.

## Decision

Use **OpenTelemetry** as the single instrumentation standard, exporting to:

- **Prometheus** for metrics
- **Grafana** for dashboards
- **Loki** for logs
- Traces to the configured backend (Tempo or vendor)

All services instrument via OTel SDK; correlation ID (`req_id` + `trace_id`)
threaded everywhere.

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| Custom metrics/logging | Duplication, no traces, high maintenance |
| Jaeger only | Traces only, metrics separate |
| Vendor-specific (Datadog) | Great but cost + data residency; heavy |

## Pros

- One standard, vendor-neutral, works across Node + Dart + k8s.
- Observed red-light dashboards with SLOs.
- Auto-instrumentation reduces work.

## Cons

- Collector to operate; some learning curve.
- Adds CPU overhead (mitigated by sampling).

## Consequences

- Ingress traces end-to-end on all critical flows.
- `infrastructure/monitoring/` has Prometheus + Grafana + Loki configs.
- AI-relevant spans (`ai.llm.generation`) give token/latency insight.

## References

- [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md)