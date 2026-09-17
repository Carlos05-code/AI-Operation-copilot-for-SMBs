# Kubernetes

Production/staging manifests for the platform, managed with **Kustomize**. Built and validated with
`kustomize build` (v5.8.1) against every overlay — no live cluster was available to also run a
server-side `kubectl apply --dry-run`, so that step is still outstanding before a real rollout.

## Topology

```mermaid
flowchart TB
    IN[NGINX Ingress + cert-manager] --> SVC[api Service]
    SVC --> API[api Deployment, HPA 2-10]
    WSVC[worker Service] --> WRK[worker Deployment, HPA 1-5]
    API --> PG[(PostgreSQL StatefulSet)]
    API --> RED[(Redis StatefulSet)]
    API --> RMQ[(RabbitMQ StatefulSet)]
    API --> NEO[(Neo4j StatefulSet)]
    API --> QDR[(Qdrant StatefulSet)]
    API --> OS[(OpenSearch StatefulSet)]
    API --> MIN[(MinIO StatefulSet)]
    API --> KC[Keycloak Deployment]
    WRK --> RED
    WRK --> RMQ
    KC --> PG
    MIG[api-migrate Job] --> PG
```

There are **two** Deployments now: `api` (HTTP + in-process BullMQ processing) and `worker`
(`apps/backend/src/main-worker.ts` — no HTTP API, just the same `@Processor`s, plus a bare
`/metrics`+`/healthz` listener for Prometheus/kubelet). BullMQ consumers on the same queue name are
safe to run concurrently by design (Redis-backed per-job locking), so `worker` is _additional_
capacity, scalable independently of `api` — it doesn't replace `api`'s own processing. Both
Deployments run the exact same image; only the container `command` (and which root module it
bootstraps) differs.

**A clean split, in one direction only**: every feature module that used to bundle an HTTP
controller with its BullMQ workers (`task.module.ts` was the typical example) is split into an HTTP
half (`<feature>.module.ts`) and a worker half (`<feature>-worker.module.ts`). `app.module.ts`
(`api`) imports **both** halves of every split module, so `api` keeps doing in-process BullMQ
processing exactly as before — that's what "worker is additional capacity, it doesn't replace api's
own processing" above depends on. `worker-app.module.ts` (`worker`) imports **only** the worker
halves: `worker` bootstraps `WorkerAppModule`, not `AppModule`, so no `@Controller` class is
reachable from that module tree at all, and `main-worker.ts`'s
`NestFactory.createApplicationContext` never instantiates one. An earlier version of this split had
`app.module.ts` import only the HTTP halves too, which silently dropped `api`'s in-process
processing to zero for all ten split queues whenever `worker` wasn't also running (true of local
dev, which only ever runs `main.ts`) — fixed, and guarded by an e2e assertion
(`test/app.e2e-spec.ts`) that resolves every worker provider out of `AppModule` directly. Verified
for real: the compiled `api` (`dist/main.js`) was run directly and its own boot log shows all ten
`*WorkerModule`s initializing alongside the HTTP modules; the compiled `worker`
(`dist/main-worker.js`) was run directly too and its boot log lists only `*WorkerModule`s,
`LlmModule`, and shared infra (`Database`, `Events`, `Queue`, `Storage`, `Embeddings`, `Graph`,
`Core`) — no `AuthModule`, `HealthModule`, `OpenApiModule`, or any HTTP-only feature module appears.
See `main-worker.ts` and `worker-app.module.ts`'s own header comments.

## Layout

```
kubernetes/
├── base/
│   ├── namespace.yaml
│   ├── backend/
│   │   ├── api-serviceaccount.yaml
│   │   ├── api-configmap.yaml         # non-secret env, mirrors .env.example
│   │   ├── api-secret.example.yaml    # TEMPLATE — documents required keys, never applied
│   │   ├── api-deployment.yaml        # HTTP + in-process BullMQ processing
│   │   ├── api-service.yaml
│   │   ├── api-hpa.yaml               # CPU/memory, 2-10 replicas
│   │   ├── api-ingress.yaml           # NGINX + cert-manager
│   │   ├── api-networkpolicy.yaml
│   │   ├── worker-serviceaccount.yaml
│   │   ├── worker-deployment.yaml     # same image, main-worker.js — no REST API
│   │   ├── worker-service.yaml        # /metrics + /healthz only, no Ingress
│   │   ├── worker-hpa.yaml            # CPU/memory, 1-5 replicas
│   │   ├── worker-networkpolicy.yaml
│   │   └── migrate-job.yaml           # `prisma migrate deploy`, run before rollout
│   ├── infrastructure/                # StatefulSets: postgres, redis, rabbitmq,
│   │                                  # neo4j, qdrant, opensearch, minio
│   └── keycloak/                      # Deployment + realm-import ConfigMap
├── overlays/
│   ├── staging/     # 1 api / 1 worker replica, :staging image tag, letsencrypt-staging
│   └── production/  # 3 api / 2 worker replicas, :production image tag — see its README
│                     # for why the in-cluster StatefulSets aren't a real prod posture
└── README.md (this file)
```

## Applying

```
kustomize build infrastructure/kubernetes/overlays/staging   # or production
```

1. Build and push `infrastructure/docker/Dockerfile.api` tagged to match the overlay (`:staging` /
   `:production`) — one image, both Deployments.
2. Create the real `api-secret` out of band — see `base/backend/api-secret.example.yaml` for every
   key it needs. Never commit the filled-in version.
3. `kubectl apply -k infrastructure/kubernetes/overlays/<staging|production>`
4. Wait for the `api-migrate` Job to complete before traffic hits a new rollout that added
   migrations:
   `kubectl wait --for=condition=complete job/api-migrate -n smb-copilot --timeout=120s`.

## Notes

- Secrets: intentionally no SealedSecrets/ESO dependency baked in here — the actual
  secret-management tool is an infra decision for whoever runs the cluster (see the production
  overlay's README); `api-secret.example.yaml` keeps the required-keys contract in one place
  regardless of which tool fills it.
- PVCs (`volumeClaimTemplates`) back every StatefulSet; no `StorageClass` is pinned, so whatever the
  cluster's default provides is used.
- HPA scales on CPU/memory only for now, for both `api` and `worker` — a queue-depth-based HPA using
  the `queue_jobs_waiting` metric this app already exports needs a Prometheus Adapter or KEDA
  installed in-cluster first (not assumed to be there); CPU is a weaker proxy for `worker`
  specifically, since a queue consumer can be CPU-idle while a backlog builds if it's waiting on an
  external call.

## See

- [DEVOPS_SPEC](../../docs/specifications/DEVOPS_SPEC.md)
- [ADR-0010](../../docs/architecture/adrs/ADR-0010-kubernetes.md)
