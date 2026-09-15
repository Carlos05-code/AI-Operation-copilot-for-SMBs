# Monitoring

Traces + metrics + logs for local dev (DEVOPS_SPEC §8). Bring it up with:

```sh
docker compose --profile monitoring up
```

- Grafana: <http://localhost:3300> (admin / `GRAFANA_ADMIN_PASSWORD`, default `changeme`)
- Prometheus: <http://localhost:9090>
- Tempo API: <http://localhost:3200> (queried by Grafana, not meant to be browsed directly)
- Loki API: <http://localhost:3100> (queried by Grafana, and by the API's own log shipper — see
  below; not meant to be browsed directly)

## Layout

```
monitoring/
├── otel-collector/
│   └── otel-collector-config.yaml   # OTLP in, forwards traces to Tempo
├── tempo/
│   └── tempo-config.yaml            # single-binary, local-disk storage
├── loki/
│   └── loki-config.yaml             # single-binary, local-disk storage
├── prometheus/
│   ├── prometheus.yml               # scrapes the API's GET /metrics
│   └── alerting-rules.yml           # SLO alerts (DEVOPS_SPEC §8)
└── grafana/
    ├── provisioning/
    │   ├── datasources/             # Prometheus + Tempo + Loki, auto-provisioned
    │   └── dashboards/              # provisioning pointer
    └── dashboards/
        └── api-overview.json        # request rate, p95 latency, error rate, queue backlog, logs
```

## How it gets there

- **Metrics**: the API always exposes `GET /metrics` (Prometheus text format) — no OTLP collector
  needed, Prometheus scrapes it directly
  (`apps/backend/src/shared/telemetry/app-metrics.service.ts`).
- **Traces**: only pushed once `OTEL_EXPORTER_OTLP_ENDPOINT` is set (e.g. `http://localhost:4318`,
  this collector) — see `.env.example`. Unset, the app is metrics-only; nothing breaks either way.
- **Logs**: always structured JSON on stdout, carrying `requestId` + `traceId`/`spanId` when a trace
  is active (`pino-logger.service.ts`). Shipped to Loki too, once `LOKI_URL` is set (e.g.
  `http://localhost:3100`, this Loki — see `.env.example`) — a second `pino` transport
  (`pino-loki`), not a container-log-tailing agent. That choice is deliberate: the API runs on the
  _host_ in local dev, not in this compose file, so a Promtail-style agent watching container logs
  would never see it anyway; pushing straight from the app over HTTP works identically whether the
  process is on the host or in a container. Unset, logging is stdout-only; nothing breaks either way
  — same on-by-config pattern as traces.
- **Trace correlation from Loki**: the Grafana Loki datasource has a `derivedFields` entry that
  matches `"traceId":"..."` in a log line's JSON body and links straight to that trace in Tempo —
  click a log line with a trace, land on the trace. `requestId`/`traceId` deliberately stay in the
  log line body, never a Loki _label_ — a per-request-unique value is exactly the high-cardinality
  mistake Loki's own docs warn against turning into an index label.

## Known gap

Nothing ships the _other_ containerized dependencies' logs (Postgres, Redis, RabbitMQ, Neo4j,
Qdrant, OpenSearch, MinIO, Keycloak, or the observability stack's own containers) into Loki — only
the API's own application logs, via the push-based transport above. A Promtail (or Grafana Alloy)
job on Docker's container log discovery would cover those too; not added here, since the app's own
logs — the ones actually carrying `requestId`/`traceId` correlation — were the actual gap this
closes, and adding a second, unrelated log-shipping mechanism for infra containers is a separate
piece of scope.

## Read more

- [DEVOPS_SPEC](../../docs/specifications/DEVOPS_SPEC.md)
