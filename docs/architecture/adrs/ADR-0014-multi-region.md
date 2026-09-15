# ADR-0014: Multi-region readiness

- Status: Proposed
- Date: 2026-09-15
- Owner: Carlos05-code
- Deciders: Infrastructure

## Context

ROADMAP Phase 5 asks for multi-region readiness. Today the platform runs in exactly one region: one
Kubernetes cluster (`infrastructure/kubernetes/`), one copy each of PostgreSQL, Neo4j, Qdrant,
OpenSearch, Redis, RabbitMQ, MinIO, and Keycloak, with nightly backups
(`infrastructure/kubernetes/base/backup/`) as the only cross-failure-domain recovery path
(`infrastructure/devops/incident.md`). A regional outage is recoverable — the runbook's "Full
cluster loss" playbook is already region-agnostic, it just stands the stack up wherever a cluster
exists — but recovery takes the RTOs that runbook documents (30 min–2h per service, plus however
long provisioning a cluster in a new region takes), not the near-zero downtime "multi-region" often
implies.

This ADR is a decision about _direction_, not an implementation — nothing here changes what's
deployed today. It exists because the six stateful dependencies have genuinely different ceilings on
what multi-region even means for them, and that needs to be decided once, deliberately, rather than
discovered store-by-store under incident pressure:

| Store      | Cross-region replication in the OSS/Community tier this repo runs                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | Streaming + logical replication — native, unrestricted, real async cross-region option                                                                                                                  |
| OpenSearch | Cross-cluster replication (CCR) — a real plugin, included in the open-source distribution (unlike Elasticsearch's paywalled equivalent)                                                                 |
| MinIO      | Site replication (active-active, bucket-level) — native, unrestricted                                                                                                                                   |
| Redis      | Async replica sets — native, but automated cross-region _failover_ needs Sentinel/Cluster, neither of which this repo runs today                                                                        |
| RabbitMQ   | Federation/shovel plugins move messages across regions async; a stretched cluster spanning regions is explicitly against RabbitMQ's own guidance (its distribution protocol is latency-sensitive)       |
| Neo4j      | **None.** Causal clustering (the only Neo4j replication mechanism) is Enterprise-only — `neo4j:5-community` (what this repo runs, ADR-0005) cannot replicate to a second instance at all, in any region |

Neo4j is the actual constraint this decision turns on: every other store has a real, native,
open-source path to an async cross-region copy. Neo4j doesn't, short of a licensing change
(Enterprise) or a managed offering (Neo4j Aura). Any multi-region design that assumes uniform
replication across all six stores is not buildable on what this repo runs today.

## Decision

Adopt a **phased, backup-restore-first** posture rather than committing to active-active replication
now:

- **Phase A (today, already shipped)**: cross-region disaster recovery via the nightly backups and
  restore runbook. RTO is what `incident.md` already documents; RPO is "since last night's backup"
  for every store (the same gap that runbook's "Known gaps" section already calls out). This is the
  actual, current multi-region-_readiness_ posture — the platform **can** come back up in a
  different region, on a timescale of hours, not the platform **runs** in multiple regions.
- **Phase B (deferred, no timeline)**: for the five stores that support it natively in the OSS tier
  — PostgreSQL, OpenSearch, MinIO, and, with added operational work, Redis and RabbitMQ — add real
  async cross-region replication to shrink RPO/RTO for those specific stores ahead of a concrete
  need (a real customer base in a second geography, or an actual data-residency requirement), not
  speculatively.
- **Phase C (deferred, blocked on a decision this ADR doesn't make)**: Neo4j has no OSS path to
  Phase B. Closing that gap means either paying for Neo4j Enterprise/Aura, or accepting Neo4j as the
  one store that stays backup-restore-only even after every other store gets faster cross-region
  recovery — a real asymmetry, not an oversight, if Phase B is ever built.

No active-active, no synchronous cross-region writes, no automatic regional failover — all three
would need infrastructure (a global load balancer, health-check-driven DNS/traffic failover, and
either accepted data loss on failover or synchronous replication's latency cost) this ADR doesn't
propose building without a concrete driver.

## Alternatives

| Option                                          | Trade-off                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active-active, all regions serving live traffic | Needs conflict resolution or sharding-by-region for every store, including one (Neo4j Community) that can't replicate at all — not buildable today                              |
| Warm standby with synchronous replication       | Lowest RPO, but synchronous cross-region writes add real write latency to every request, for a failure mode (regional outage) that's rare                                       |
| Warm standby with async replication, all stores | Blocked identically by Neo4j — same Phase C gap, just attempted immediately instead of phased                                                                                   |
| Do nothing beyond today's backups               | Cheapest, but leaves multi-region as a checkbox nobody actually improves — this ADR's phasing at least names Phase B/C as real, prioritizable work instead of closing the topic |

## Pros

- Phase A costs nothing new — it's the backup/DR work already shipped, just named correctly as what
  it is (region-agnostic disaster recovery, not high-availability multi-region).
- Phases B/C are only built when there's a real reason to, avoiding speculative infrastructure spend
  and operational complexity (replica monitoring, split-brain handling, cross-region network costs)
  ahead of any actual multi-region traffic.
- Names the Neo4j constraint explicitly, so it's a known, prioritizable decision (pay for
  Enterprise/Aura, or accept the asymmetry) rather than something discovered mid-incident.

## Cons

- RPO stays "since last night's backup" for every store until Phase B is actually built for each —
  this ADR doesn't improve today's numbers, it only sequences future improvement.
- "Readiness" here means "can recover in a new region in hours," not "is resilient to a regional
  outage with no customer-visible downtime" — if the business need is actually the latter, this
  decision is insufficient and would need revisiting (likely superseding this ADR) rather than
  extending it.
- Phase C's asymmetry (every store but Neo4j eventually fast, Neo4j staying slow) is a real
  long-term wart if Phase B ships without ever resolving it.

## Consequences

- No code or infrastructure changes ship with this ADR.
- `docs/specifications/DEVOPS_SPEC.md` and `infrastructure/devops/incident.md` should be read as
  already describing Phase A in full; neither needs new content for this decision, since Phase A is
  exactly what they already document.
- Before Phase B starts on any store, that work needs its own ADR-or-equivalent scoping (which store
  first, what RPO/RTO target justifies the added operational surface) — this ADR sets direction, it
  doesn't authorize implementation.
- Phase C requires an explicit, budgeted decision (Neo4j Enterprise/Aura licensing cost vs.
  accepting the asymmetry) before Phase B work on other stores reaches a point where Neo4j is the
  visibly weakest link.

## References

- [DEVOPS_SPEC §9](../../specifications/DEVOPS_SPEC.md)
- [infrastructure/devops/incident.md](../../../infrastructure/devops/incident.md)
- [infrastructure/kubernetes/base/backup/](../../../infrastructure/kubernetes/base/backup/)
- [ADR-0005 (Neo4j)](./ADR-0005-neo4j.md)
- [ADR-0010 (Kubernetes)](./ADR-0010-kubernetes.md)
