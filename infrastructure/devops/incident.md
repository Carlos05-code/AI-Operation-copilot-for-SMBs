# Disaster recovery runbook

Restore procedures for every stateful dependency, plus scenario playbooks for the incidents most
likely to actually happen. Automation this runbook depends on lives in
`infrastructure/kubernetes/base/backup/` — read that directory's CronJobs before running any command
below, since the exact object keys/paths they write to are the source of truth, not this prose.

Referenced from `docs/specifications/DEVOPS_SPEC.md` §9 and `docs/devops/oncall.md`. Declare a SEV
per `docs/devops/oncall.md` before starting any restore below — a restore is itself a destructive
operation on whatever it overwrites.

## RTO/RPO targets (DEVOPS_SPEC §9)

| Resource   | Backup mechanism                                                                       | RPO                 | RTO       |
| ---------- | -------------------------------------------------------------------------------------- | ------------------- | --------- |
| PostgreSQL | Continuous WAL archiving (`wal-g`) + daily base backup + nightly `pg_dump` (02:00 UTC) | <= 5m¹              | <= 30 min |
| Neo4j      | Nightly APOC streaming export (02:15 UTC)                                              | <= 24h              | <= 2h     |
| Qdrant     | Nightly per-collection snapshot (02:30 UTC)                                            | <= 24h              | <= 2h     |
| OpenSearch | Nightly `s3`-repository snapshot (02:45 UTC)                                           | <= 24h²             | <= 2h     |
| MinIO      | Continuous (bucket versioning)                                                         | ~0 (object history) | minutes   |
| Redis      | Continuous (AOF) + RDB snapshots every 60s-15m depending on load                       | <= 60s              | minutes   |

¹ Every completed WAL segment ships continuously via `archive_command` — DEVOPS_SPEC §9's RPO<=5m
target is what that mechanism should deliver, **not yet exercised against a live cluster**; see
"Known gaps" below before trusting it in a real incident. ² Snapshots go to the
`smb-copilot-backups` MinIO bucket via the `repository-s3` plugin
(`infrastructure/kubernetes/base/infrastructure/opensearch.yaml`), off-cluster like every other
service's backup — wired up and matching OpenSearch's own documented plugin/keystore setup, but
**not yet exercised against a live cluster**; see "Known gaps".

## Known gaps — read before relying on this in a real incident

- **PostgreSQL WAL archiving/PITR is unverified against a live cluster.** `wal-g wal-push`/
  `backup-push` via `archive_command` and a daily base-backup sidecar
  (`infrastructure/kubernetes/base/infrastructure/postgres.yaml`) are wired up and match wal-g's
  documented env vars/commands, and the pinned binary was downloaded and checksummed for real while
  building this — but no live cluster was available to actually archive a WAL segment, take a base
  backup, and restore from it end-to-end. **Before depending on this for a real incident, do exactly
  that once against a disposable cluster.**
- **OpenSearch's S3 snapshot repository is unverified against a live cluster.** The `repository-s3`
  plugin (fetched by an `initContainer`, since this repo doesn't build custom OpenSearch images) and
  an OpenSearch keystore holding the S3 credentials (built by a second `initContainer`) are wired up
  in `infrastructure/kubernetes/base/infrastructure/opensearch.yaml`, matching OpenSearch's own
  snapshot-restore docs — but no live cluster was available to actually install the plugin, load the
  keystore, register the repository, take a snapshot, and restore it end-to-end. **Before depending
  on this for a real incident, do exactly that once against a disposable cluster.**
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

**Point-in-time recovery** (a narrower window than "restore last night's dump" — e.g. "restore to 5
minutes before the bad migration ran"), using the WAL archive instead of the logical dump:

```sh
# 1. See what base backups and WAL segments actually exist before picking a target time.
kubectl exec -n smb-copilot postgres-0 -c postgres -- /walg-bin/wal-g backup-list
kubectl exec -n smb-copilot postgres-0 -c postgres -- /walg-bin/wal-g wal-show

# 2. Stop postgres, wipe PGDATA (a fresh restore replaces it entirely), fetch the base backup.
kubectl exec -n smb-copilot postgres-0 -c postgres -- pg_ctl -D "$PGDATA" stop -m fast
kubectl exec -n smb-copilot postgres-0 -c postgres -- sh -c 'rm -rf "$PGDATA"/*'
kubectl exec -n smb-copilot postgres-0 -c postgres -- \
  /walg-bin/wal-g backup-fetch "$PGDATA" LATEST   # or a specific backup name from step 1

# 3. Tell postgres to replay WAL up to the target time, then start it.
kubectl exec -n smb-copilot postgres-0 -c postgres -- sh -c '
  touch "$PGDATA/recovery.signal"
  cat >> "$PGDATA/postgresql.auto.conf" <<EOF
restore_command = '"'"'/walg-bin/wal-g wal-fetch %f %p'"'"'
recovery_target_time = '"'"'<YYYY-MM-DD HH:MM:SS UTC>'"'"'
recovery_target_action = '"'"'promote'"'"'
EOF
'
kubectl exec -n smb-copilot postgres-0 -c postgres -- pg_ctl -D "$PGDATA" start

# 4. Watch it recover and promote, then validate exactly like the logical-restore path above.
kubectl logs -n smb-copilot postgres-0 -c postgres -f
```

This is the standard PostgreSQL recovery mechanism (`recovery.signal` + `restore_command` +
`recovery_target_time`, all real PostgreSQL config, not wal-g-specific) — `wal-g wal-fetch` is just
what `restore_command` calls to pull each WAL segment back from the same `smb-copilot-backups`
bucket the archiving side pushes to. Same destructive caveat as above: this replaces PGDATA
entirely.

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
# Snapshots live in the smb-copilot-backups MinIO bucket via the s3_backup repository (see
# "Known gaps") -- list what exists:
kubectl exec -n smb-copilot opensearch-0 -- \
  curl -sf http://localhost:9200/_snapshot/s3_backup/_all

# Restore (OpenSearch refuses to restore an index that already exists -- close or delete it first
# if this is a point-in-time rollback rather than a fresh cluster).
kubectl exec -n smb-copilot opensearch-0 -- curl -sf -X POST \
  "http://localhost:9200/_snapshot/s3_backup/snapshot-<STAMP>/_restore" \
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
