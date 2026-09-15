# Production overlay

3 replicas, HPA floor raised to 3, `api`/migration image pinned to the `production` tag. Ingress
host and `letsencrypt-prod` issuer are unchanged from the base — set the real domain there once one
exists (currently `api.smb-copilot.example.com`, a placeholder).

## The in-cluster StatefulSets are a staging convenience, not a production posture

`../../base/infrastructure/` (Postgres, Redis, RabbitMQ, Neo4j, Qdrant, OpenSearch, MinIO) are
single-replica StatefulSets with no backup, failover, or point-in-time recovery — fine for
exercising the full topology in staging, not something to run a real customer's data on.

For an actual production cluster, the recommended path is:

1. Provision managed equivalents instead (RDS/Cloud SQL for Postgres, a managed Redis, Amazon
   MQ/CloudAMQP for RabbitMQ, Neo4j Aura, Qdrant Cloud or a self-hosted-but-backed-up Qdrant, a
   managed OpenSearch/Elasticsearch, S3 directly instead of MinIO).
2. Drop `infrastructure` from this overlay's resource set (fork `../../base/kustomization.yaml`'s
   resource list, or add a `$patch: delete` per StatefulSet — whichever fits the target cloud) and
   point `api-config`/`api-secret`'s host/URL values at the managed endpoints instead.

Which managed services to use is a real infrastructure decision (cost, region, existing cloud
commitments) this repo can't make on your behalf — concrete provider manifests aren't included here
until that decision exists to build them against.

## Before applying

Same as `../staging/README.md`: build+push the `production`-tagged image, create the real
`api-secret` out of band, `kubectl apply -k infrastructure/kubernetes/overlays/production`, then run
`migrate-job.yaml`.
