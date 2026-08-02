# DevOps Specification

Status: **Draft · v0** · Owner: Carlos05-code

## 1. Scope

How we ship: local Docker Compose → CI → Kubernetes → production posture,
with observability, backups, and recovery as core elements.

## 2. Docker & Compose (local dev)

- `docker-compose.yml` brings up all LAN services (see repository root).
- Compose profiles: `dev` (all), `monitoring` (prom/grafana/loki), `ai`.
- Secrets never in compose file; read via `configs/.env`.
- All images pinned to a digest or a patch-versioned tag.

## 3. Kubernetes deployment

- Manifest dir `infrastructure/kubernetes/`.
- App deployable as modular monolith + workers (HPA).
- Ingress: NGINX ingress controller; TLS via cert-manager.
- RBAC in-cluster for namespaces; network policies restrict egress/ingress.

```mermaid
flowchart TB
    U[Users] --> IN[NGINX Ingress]
    IN --> API[api Deployment]
    API --> PG[(PostgreSQL StatefulSet)]
    API --> RED[(Redis StatefulSet)]
    API --> RMQ[(RabbitMQ StatefulSet)]
    SVC[Buses] --> WK[workers Deployment]
    WK --> MIN[(MinIO)]
    WK --> NEO[(Neo4j StatefulSet)]
    WK --> VEC[(Qdrant StatefulSet)]
    WK --> OS[(OpenSearch StatefulSet)]
    API --> KC[Keycloak]
```

## 4. CI/CD (GitHub Actions)

Workflows in `.github/workflows/`:

| Workflow | Trigger | Purpose |
| -------- | ------- | ------- |
| `lint.yml` | PR | ESLint, Prettier, Flutter analyze |
| `build.yml` | PR + merge  | API build, mobile build (matrix) |
| `docs.yml` | PR | Markdown lint + link check + Mermaid validate |
| `security-scan.yml` | PR + schedule | Semgrep, gitleaks, dep audit, Trivy |
| `db-migrate-check` | PR touching prisma | validate migrations |
| `release.yml` | tag v* | build images, migrate, deploy, changelog |

Pr release: all check workflows must be green; PR must pass `Definition of Done`.

## 5. Environments

| Env | Purpose | Provisioning |
| --- | ------- | ------------ |
| `dev` | developers fix branch against shared infra (Compose) | local |
| `staging` | merged main, manual automation | K8s preview cluster |
| `production` | release candidate | K8s prod clusters |

- Promotion: only tagged releases move beyond staging.
- Feature flags: flags declared in `packages/config`, toggled per env.

## 6. Deployment strategy

- Rolling update with 2-replica minimum per service; `maxSurge: 1` `maxUnavailable: 0`.
- Zero-downtime migrations: expand → backfill → contract.
- Rollback: previous tag redeploy; DB migrations handled with `migrate deploy`
  forward-only; destructive changes gated behind feature flag or later release.

## 7. Scaling

- Stateless API/Nest pods scaled by HPA on CPU + RPS.
- Worker queues: HPA on queue depth (BullMQ).
- PostgreSQL: read replica for reads; unlogged for hot tables where safe.
- OpenSearch/Qdrant/Neo4j scale budgeted per org tokens (cost control).

## 8. Observability

- OpenTelemetry unified: traces + metrics + logs per service.
- Exporters: Prometheus (metrics), Grafana (dashboards), Loki (logs), Tempo
  (traces, optional).
- Default alerts:
  - SLO: API p95 latency > 800 ms, error rate > 1%, queue backlog pump alerts.
  - DB connections >= 70%, disk auto-scaling warnings.
- Correlation: `trace_id` + `req_id` in all logs.

## 9. Backup & recovery

| Resource | Strategy | RTO/RPO |
| -------- | -------- | ------ |
| PostgreSQL | WAL archiving, PITR; nightly full dumps | RPO <= 5m, RTO <= 30m |
| Neo4j | dump backups (per graph) | RPO 1h, RTO 2h |
| Qdrant | snapshot per collection to object store | RPO 1h, RTO 2h |
| OpenSearch | snapshot repository | RPO 1h, RTO 2h |
| MinIO | bucket replication / version history | RPO 15m (continuous) |
| Redis | AOF + scheduled RDB | RPO 5m |

- Disaster recovery: runbook `infrastructure/devops/incident.md` (DR) with
  failover to secondary region, restore-from-backups and validation checks.

## 10. Monitoring inventory

- Exporters/dashboards in `infrastructure/monitoring/`:
  - Prometheus scrape configs + `ServiceMonitor`.
  - Grafana dashboards JSON (API SLIs, workers, DB, queues).
  - Alerting rules (under `alerts/`).

## 11. Release process

1. Tag `vX.Y.Z` (semver, from CHANGELOG).
2. CI builds images, runs migrations in staging, runs smoke/e2e.
3. Manual approval gate in Actions for GA; blue-green switch.
4. On success: release notes appended; version bumped in `package.json`.

## 12. Related

- [Terraform notes](./infrastructure/devops/ ) (stub for IaC decision)