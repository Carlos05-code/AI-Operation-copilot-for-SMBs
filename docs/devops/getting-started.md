# Getting Started (DevOps)

How to get a local environment running.

## 0. Prerequisites

| Tool           | Version | Why                  |
| -------------- | ------- | -------------------- |
| Docker         | ≥ 24    | containers           |
| Docker Compose | ≥ 2.x   | local stack          |
| pnpm           | ≥ 9     | monorepo             |
| Node.js        | ≥ 20    | backend              |
| Flutter        | ≥ 3.24  | mobile               |
| Make           | any     | convenience commands |

## 1. Install

```bash
git clone git@github.com:Carlos05-code/AI-Operation-copilot-for-SMBs.git
cd AI-Operation-copilot-for-SMBs
make setup
```

## 2. Start infrastructure

```bash
cp .env.example .env        # fill in secrets (local dev only)
make infra-up
docker compose ps           # all healthy
```

This starts: PostgreSQL, Redis, RabbitMQ, Neo4j, Qdrant, OpenSearch, MinIO, Keycloak.

## 3. Migrate & seed

```bash
make db-generate
make db-migrate
make db-seed
```

## 4. Run API

```bash
make api-dev      # http://localhost:3000/api/v1/health
```

## 5. Run mobile app

```bash
make mobile-dev
```

## 6. Open the dashboard

```
PostgreSQL  http://localhost:5432
RabbitMQ   http://localhost:15672 (ops / changeme)
Neo4j      http://localhost:7474
MinIO      http://localhost:9001
Keycloak   http://localhost:8080
OpenSearch http://localhost:9200
```

Keycloak admin console: `admin / changeme` (see `KEYCLOAK_ADMIN_PASSWORD`). The `smb-copilot` realm
is imported automatically from `infrastructure/keycloak/realm.json` on first boot and provides demo
users `owner@`/`manager@`/`viewer@acme-demo.local` (password `changeme`), roles
`owner/admin/manager/agent/viewer`, and the `org_id` + `org.role` token claims the API validates
(see `docs/security/authentication.md`).

## Troubleshooting

- Port conflicts: edit `docker-compose.yml` port mappings.
- Keycloak realm changes: edit `infrastructure/keycloak/realm.json`, then
  `docker compose up -d --force-recreate keycloak` (recreate the Keycloak volume to re-import).
- Use `make infra-down` / `make infra-down-volumes` to reset.

---

→ [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md) · [Compose file](../../docker-compose.yml)
