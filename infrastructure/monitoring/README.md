# Monitoring

Traces + metrics for local dev (DEVOPS_SPEC §8). Bring it up with:

```sh
docker compose --profile monitoring up
```

- Grafana: <http://localhost:3300> (admin / `GRAFANA_ADMIN_PASSWORD`, default `changeme`)
- Prometheus: <http://localhost:9090>
- Tempo API: <http://localhost:3200> (queried by Grafana, not meant to be browsed directly)

## Layout

```
monitoring/
├── otel-collector/
│   └── otel-collector-config.yaml   # OTLP in, forwards traces to Tempo
├── tempo/
│   └── tempo-config.yaml            # single-binary, local-disk storage
├── prometheus/
│   ├── prometheus.yml               # scrapes the API's GET /metrics
│   └── alerting-rules.yml           # SLO alerts (DEVOPS_SPEC §8)
└── grafana/
    ├── provisioning/
    │   ├── datasources/             # Prometheus + Tempo, auto-provisioned
    │   └── dashboards/              # provisioning pointer
    └── dashboards/
        └── api-overview.json        # request rate, p95 latency, error rate, queue backlog
```

## How it gets there

- **Metrics**: the API always exposes `GET /metrics` (Prometheus text format) — no OTLP collector
  needed, Prometheus scrapes it directly
  (`apps/backend/src/shared/telemetry/app-metrics.service.ts`).
- **Traces**: only pushed once `OTEL_EXPORTER_OTLP_ENDPOINT` is set (e.g. `http://localhost:4318`,
  this collector) — see `.env.example`. Unset, the app is metrics-only; nothing breaks either way.
- **Logs**: structured JSON on stdout, already carrying `requestId` + `traceId`/`spanId` when a
  trace is active (`pino-logger.service.ts`) — so a log line can already be pivoted to its trace
  once you're looking at logs. **Not yet wired up**: shipping those logs into Loki (a Promtail
  sidecar, or Docker's own Loki logging driver) — an operational addition that needs no application
  code changes when it lands.

## Read more

- [DEVOPS_SPEC](../../docs/specifications/DEVOPS_SPEC.md)
