# Disaster recovery runbook

Restore procedures for every stateful dependency, plus scenario playbooks for the incidents most
likely to actually happen. Automation this runbook depends on lives in
`infrastructure/kubernetes/base/backup/` — read that directory's CronJobs before running any command
below, since the exact object keys/paths they write to are the source of truth, not this prose.

Referenced from `docs/specifications/DEVOPS_SPEC.md` §9 and `docs/devops/oncall.md`. Declare a SEV
per `docs/devops/oncall.md` before starting any restore below — a restore is itself a destructive
operation on whatever it overwrites.

## RTO/RPO targets (DEVOPS_SPEC §9)

| Resource   | Backup mechanism                                                 | RPO                 | RTO       |
| ---------- | ---------------------------------------------------------------- | ------------------- | --------- |
| PostgreSQL | Nightly `pg_dump` (02:00 UTC)                                    | <= 24h¹             | <= 30 min |
| Neo4j      | Nightly APOC streaming export (02:15 UTC)                        | <= 24h              | <= 2h     |
| Qdrant     | Nightly per-collection snapshot (02:30 UTC)                      | <= 24h              | <= 2h     |
| OpenSearch | Nightly `fs`-repository snapshot (02:45 UTC)                     | <= 24h²             | <= 2h     |
| MinIO      | Continuous (bucket versioning)                                   | ~0 (object history) | minutes   |
| Redis      | Continuous (AOF) + RDB snapshots every 60s-15m depending on load | <= 60s              | minutes   |

¹ DEVOPS_SPEC §9 targets RPO<=5m via WAL archiving/PITR — **not implemented**; see "Known gaps"
below. Today's real RPO is however old the last nightly dump is. ² Snapshots land on OpenSearch's
own second PVC (`fs` repository, no S3 plugin installed) — this protects against index corruption or
an accidental delete, not against losing that PVC/node. See "Known gaps".

## Known gaps — read before relying on this in a real incident

- **No WAL archiving/PITR for PostgreSQL.** The nightly dump is the only recovery point; anything
  written after the last 02:00 UTC dump is lost in a full-loss scenario. Closing this needs a WAL
  archiving sidecar (e.g. `wal-g`/`pgbackrest`) added to the StatefulSet — real, scoped work, not
  done here.
- **OpenSearch snapshots aren't off-cluster.** They live on a PVC in the same cluster as the live
  data. Closing this needs the `repository-s3` plugin installed (an `initContainer` in the
  StatefulSet, mirroring how OpenSearch/Elasticsearch normally add plugins) plus S3 credentials
  registered in the OpenSearch keystore — real, scoped work, not done here.
- **The Neo4j backup path is unverified against a live cluster.**
  `apoc.export.cypher.all(..., {stream: true})` returning the dump over Bolt to the backup job
  (rather than writing server-side, which the job's separate pod could never read back out) is the
  correct approach per APOC's documented contract, but no live Neo4j instance was available to
  actually run it end-to-end while writing this. **Before depending on this backup, run it once
  against a real cluster and confirm the output file is non-empty, valid Cypher.**
- **No automated restore drills.** Every procedure below is written correctly to the best of this
  session's knowledge but has not been executed end-to-end. Run each at least once against a
  disposable staging namespace before trusting it in a real incident — a backup you've never
  restored from is a hypothesis, not a backup.

## Restore procedures

Every command below assumes `kubectl` is pointed at the target cluster/namespace (`smb-copilot`) and
`mc` is aliased to the backup store:

```sh
mc alias set backupstore http://<minio-endpoint> <STORAGE_ACCESS_KEY> <STORAGE_SECRET_KEY>
```

### PostgreSQL

```sh
# 1. Find the dump to restore (newest, or a specific point-in-time one)
mc ls backupstore/smb-copilot-backups/postgres/

# 2. Copy it out and restore into a running postgres pod
mc cp backupstore/smb-copilot-backups/postgres/postgres-<STAMP>.dump ./restore.dump
kubectl cp ./restore.dump smb-copilot/postgres-0:/tmp/restore.dump
kubectl exec -n smb-copilot postgres-0 -- \
  pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump

# 3. Validate
kubectl exec -n smb-copilot postgres-0 -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM organizations;"
```

`--clean --if-exists` drops existing objects before recreating them — this is a **destructive**
restore onto whatever is currently in the database. Only run it when the SEV declaration has
confirmed that's the intended outcome (not, for example, a routine drill against prod).

### Neo4j

```sh
mc ls backupstore/smb-copilot-backups/neo4j/
mc cp backupstore/smb-copilot-backups/neo4j/neo4j-<STAMP>.cypher ./restore.cypher
kubectl cp ./restore.cypher smb-copilot/neo4j-0:/tmp/restore.cypher
kubectl exec -n smb-copilot neo4j-0 -- \
  cypher-shell -u neo4j -p "$NEO4J_PASSWORD" -f /tmp/restore.cypher

# Validate
kubectl exec -n smb-copilot neo4j-0 -- \
  cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "MATCH (n) RETURN count(n);"
```

Replaying the exported Cypher statements re-creates every node/relationship with its original
properties — it does not clear the database first, so restoring into a non-empty graph will
duplicate data. For a full-loss restore, wipe the `data` PVC (or delete and let a new empty one
provision) before replaying.

### Qdrant

```sh
mc ls backupstore/smb-copilot-backups/qdrant/<collection>/
mc cp backupstore/smb-copilot-backups/qdrant/<collection>/<snapshot-name> ./restore.snapshot

# Upload the snapshot back into the running qdrant pod's own snapshot directory, then recover
# from it (Qdrant's snapshot-recovery API, not a plain file copy into the storage dir).
kubectl cp ./restore.snapshot smb-copilot/qdrant-0:/qdrant/snapshots/<collection>/restore.snapshot
kubectl exec -n smb-copilot qdrant-0 -- curl -sf -X PUT \
  "http://localhost:6333/collections/<collection>/snapshots/recover" \
  -H 'Content-Type: application/json' \
  -d '{"location": "file:///qdrant/snapshots/<collection>/restore.snapshot"}'

# Validate
kubectl exec -n smb-copilot qdrant-0 -- curl -sf "http://localhost:6333/collections/<collection>"
```

### OpenSearch

```sh
# Snapshots already live on OpenSearch's own PVC (see "Known gaps") -- list what exists:
kubectl exec -n smb-copilot opensearch-0 -- \
  curl -sf http://localhost:9200/_snapshot/fs_backup/_all

# Restore (OpenSearch refuses to restore an index that already exists -- close or delete it first
# if this is a point-in-time rollback rather than a fresh cluster).
kubectl exec -n smb-copilot opensearch-0 -- curl -sf -X POST \
  "http://localhost:9200/_snapshot/fs_backup/snapshot-<STAMP>/_restore" \
  -H 'Content-Type: application/json' -d '{"indices":"*","include_global_state":true}'

# Validate
kubectl exec -n smb-copilot opensearch-0 -- curl -sf http://localhost:9200/_cluster/health
```

### MinIO

Versioning (`infrastructure/kubernetes/base/backup/minio-versioning-job.yaml`) keeps every prior
version of an overwritten/deleted object — recovery is listing versions and restoring the one you
want, not a bulk "restore the bucket" operation:

```sh
mc ls --versions backupstore/smb-copilot/<object-key>
mc cp --version-id <version-id> backupstore/smb-copilot/<object-key> ./recovered-file
mc cp ./recovered-file backupstore/smb-copilot/<object-key>
```

### Redis

Redis backs BullMQ queues and cached reads only — nothing here is a system of record (Postgres is).
The cheapest real recovery is usually **do nothing**: let the StatefulSet's PVC reload whatever
AOF/RDB file survived, and let in-flight jobs that were lost simply not have run (BullMQ producers
re-enqueue on their own schedule/trigger for anything periodic). If the PVC itself is gone:

```sh
# A fresh pod with an empty PVC just starts with an empty Redis -- no restore step exists because
# there is nothing external to restore from (no off-box Redis backup is shipped; see DEVOPS_SPEC
# §9's "AOF + scheduled RDB" -- both live only on the same PVC the live data does).
kubectl delete pod -n smb-copilot redis-0
```

## Scenario playbooks

### Full cluster loss

1. Provision a new cluster; apply the target overlay (`infrastructure/kubernetes/overlays/<env>`)
   minus `base/backup` and `base/infrastructure` if this is now pointing at managed services instead
   (`overlays/production/README.md`).
2. Wait for every StatefulSet's pod to reach `Running` — fresh, empty PVCs.
3. Run the migration Job (`base/backend/migrate-job.yaml`) so the schema exists before restoring
   into it.
4. Restore PostgreSQL, then Neo4j, Qdrant, OpenSearch in any order (no cross-dependencies at restore
   time) using the procedures above, using the newest backup of each.
5. Recreate the MinIO bucket structure (`minio-versioning-job.yaml` creates both buckets) — object
   data itself has no backup path today (see "Known gaps": MinIO's own versioning protects against
   overwrite/delete, not losing the MinIO PVC entirely — a real gap for uploaded documents
   specifically, since those live in MinIO with no second copy anywhere).
6. Point DNS/Ingress at the new cluster; smoke-test with `tests/load/smoke.ts` before declaring the
   incident resolved.

### Single-service data loss or corruption (e.g., a bad migration wiped a table)

1. Declare SEV-1 if it's PostgreSQL/the primary datastore, SEV-2 otherwise.
2. Stop write traffic to the affected service if the corruption is still ongoing (scale the `api`
   Deployment to 0, or a targeted feature flag if one exists — there's no global maintenance-mode
   switch today).
3. Restore that one service from its most recent backup (procedures above). Cross-check
   `generatedAt` timestamps / row counts against what's expected before restoring write traffic.
4. Resume traffic; watch the DEVOPS_SPEC §8 SLO dashboards for 15+ minutes before closing the
   incident.

### Accidental destructive migration

- `prisma migrate deploy` is forward-only (DEVOPS_SPEC §6) — there is no automatic rollback.
  Recovery is the PostgreSQL restore procedure above, accepting the RPO gap back to the last nightly
  dump (see "Known gaps" — this is exactly the scenario WAL archiving/PITR would fix and currently
  doesn't).

### Region loss / multi-region failover

- Not implemented. ROADMAP Phase 5 tracks "Multi-region readiness documented in an ADR" as a
  separate, not-yet-started item — this runbook has nothing to say about failover to a secondary
  region because no secondary region, replication, or failover mechanism exists yet.
