# Monitoring

Prometheus, Grafana, and Loki configuration for the platform.

## Layout

```
monitoring/
├── prometheus/
│   ├── prometheus.yml       # scrape config
│   └── alerting-rules.yml   # SLO-alert definitions
├── grafana/
│   ├── provisioning/
│   └── dashboards/          # JSON dashboards
└── loki/
    └── loki-config.yaml     # log aggregation
```

## Targets

- `apps/backend` (metrics on `/metrics`), workers, databases.
- Scrape every 15 s; alerting rules on p95 latency, error rate, queue depth.

## Read more

- [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md)