# ADR-0010: Kubernetes for production orchestration

- Status: Accepted
- Date: 2026-08-02
- Owner: Platform
- Deciders: Infrastructure

## Context

Production needs horizontal scaling (API, workers), rolling deploys, self-healing, secrets, and
consistent multi-env (staging/prod). Options: manual VMs with deploy scripts, Docker Swarm, AWS ECS,
Kubernetes (kubeadm/EKS/GKE/k3s).

## Decision

Use **Kubernetes** as the container orchestrator for production and staging.

- Persistent data stores (PostgreSQL, Neo4j, Qdrant, OpenSearch, MinIO, Redis) run as StatefulSets
  with PVCs (managed infra for high-availability where available).
- App services: Deployments + HPA; workers as separate Deployment.
- Ingress: NGINX; cert-manager TLS.
- Secrets: Kubernetes Secrets (SealedSecrets) injected via env.

## Alternatives

| Option                 | Trade-off                           |
| ---------------------- | ----------------------------------- |
| Docker Compose in prod | Easy but single-host, no HA/rolling |
| ECS                    | AWS-only, less portable             |
| VMs/manual             | No auto-scaling/self-healing        |

## Pros

- Portability (run on any CNCF conformant cloud).
- Horizontal scaling, rolling deploys, self-healing.
- Rich ecosystem for observability (ADR-0011).

## Cons

- Operational complexity (upgrades, networking).
- Requires Kubernetes skills.

## Consequences

- Kubernetes manifests in `infrastructure/kubernetes/`.
- HPA on CPU/RPS for API; queue-depth for workers (DEVOPS).
- Zero-downtime deploy strategy + disaster-recovery runbooks.

## References

- [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md)
- [infrastructure/kubernetes](../../infrastructure/kubernetes)
