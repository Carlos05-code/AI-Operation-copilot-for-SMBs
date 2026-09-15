# Large-document-volume benchmark (200k+ documents)

ROADMAP Phase 5. Tooling and methodology for measuring the ingestion pipeline and the search/RAG
paths (AI_ARCHITECTURE §4–§10) at 200k+ document scale — **not a benchmark result**. No live cluster
with 200k+ documents exists in the environment this was built in, so every number below is either a
real, computed capacity estimate from this app's own chunking constants, or a template waiting for a
real run to fill in. Don't mistake either for a measured result.

This is a different axis from `tests/load/` — that suite holds corpus size fixed and varies
concurrent users; this one holds concurrency modest and varies corpus size, because retrieval
quality/latency at 200k documents is governed by index size, not request rate.

## What's here

| File                  | Purpose                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `generate-corpus.mjs` | Deterministic synthetic document generator (seeded — same `--seed` = same corpus) |
| `ingest-corpus.mjs`   | Bulk-ingests a directory through the real API pipeline, bounded concurrency       |
| `report.mjs`          | Throughput + latency-percentile summary from an ingest run's log                  |

All three are plain Node ESM (`.mjs`) — no build step, no dependency install, run directly with
`node`. Verified end-to-end (real login/presign/PUT/register/ingest HTTP calls, not just read)
against a local mock server during development; not against a real backend+Keycloak (none available
here).

## Running the full 200k benchmark

```sh
# 1. Generate the corpus (takes a few minutes; ~3-4GB of .txt files on disk for 200k docs
#    at this generator's default 200-3000 word range)
node generate-corpus.mjs --count 200000 --out ./corpus --seed 42

# 2. Ingest it. Start conservative on concurrency — the real bottleneck at volume is usually
#    the embeddings provider's own rate limit (EMBEDDINGS_API_URL), not this script or the API.
node ingest-corpus.mjs --dir ./corpus --concurrency 20 \
  --base-url https://api-staging.smb-copilot.example.com \
  --keycloak-url https://auth-staging.smb-copilot.example.com

# 3. While that runs (and after it finishes), watch the embedding queue drain via the
#    Grafana dashboard (infrastructure/monitoring/) or directly:
kubectl exec -n smb-copilot <a pod with curl> -- \
  curl -s http://api/metrics | grep queue_jobs_waiting

# 4. Summarize ingest throughput/latency once it's done
node report.mjs --log ./results/ingest-log.jsonl

# 5. Run tests/load/smoke.ts (or a custom k6 script hitting `search`/`chat`) against the now-
#    large corpus to see query latency at this corpus size, and compare against the same
#    scenario run at 10k/50k/100k checkpoints to chart how latency scales with index size.
```

Re-run step 5 at each size checkpoint (10k, 50k, 100k, 200k) rather than only at the end — a single
200k data point tells you far less than a curve.

## Capacity estimate (computed, not measured)

From this app's own chunking constants
(`apps/backend/src/modules/embeddings/embeddings.constants.ts`): 384-token target chunks, 64-token
overlap (320 new tokens per chunk after the first), 1024-dim embeddings,
`estimateTokens(text) = ceil(text.length * 0.25)` (~4 chars/token).

This generator's default document (200–3000 words, ~2.2KB–33KB of text) averages roughly 1600 words
≈ 8.8KB ≈ **~2,200 tokens** per document → `(2200 - 64) / 320 ≈ 6.7`, so **~7 chunks/document** on
average with these settings. **200,000 documents ≈ 1.4M chunks** (vectors).

| Store      | What scales                                                  | Rough estimate at 200k docs / 1.4M chunks                                                                                                                    |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Qdrant     | 1 vector (4KB raw, 1024×f32) + payload (≤4KB text) per chunk | ~5.6GB raw vectors + ~5.6GB payload text ≈ **8–16GB** including HNSW index overhead (varies with `m`/`ef_construct`, not measured here)                      |
| OpenSearch | Full-text index of each doc's clean text                     | ~1.8GB raw text → **~2–3GB** indexed (BM25 inverted-index overhead is typically 1–1.3x source)                                                               |
| PostgreSQL | One `knowledge_documents` row (metadata only) per doc        | **~200–400MB** — negligible next to the vector/text stores                                                                                                   |
| Neo4j      | Entities/relationships extracted per document                | **Not estimated** — depends entirely on entity density in the real corpus, which this synthetic generator's fixed vocabulary doesn't represent realistically |
| MinIO      | The original uploaded file per doc                           | **~1.8–3.6GB** at this generator's size range                                                                                                                |

Every "GB" above is a computed lower/rough bound from real constants, not a measured footprint —
actual index overhead (HNSW graph links, OpenSearch segment merging, Qdrant on-disk vs. in-memory
mode) varies with configuration this repo hasn't tuned yet. Treat this table as "don't provision
less than this," not "provision exactly this."

The base StatefulSet resource requests/limits in
`infrastructure/kubernetes/base/infrastructure/{qdrant,opensearch}.yaml` (512Mi–2Gi) are sized for
the staging/demo scale this repo has actually run at, not 200k documents — raise them (and the PVC
sizes) before actually running this at full scale, based on the table above.

## Results template

Fill in after a real run — replace every `TBD`:

| Corpus size | Ingest throughput (docs/s) | Ingest p95 latency | `ai-jobs` queue drain time | Search p95 (post-drain) | Chat p95 (post-drain) |
| ----------- | -------------------------- | ------------------ | -------------------------- | ----------------------- | --------------------- |
| 10,000      | TBD                        | TBD                | TBD                        | TBD                     | TBD                   |
| 50,000      | TBD                        | TBD                | TBD                        | TBD                     | TBD                   |
| 100,000     | TBD                        | TBD                | TBD                        | TBD                     | TBD                   |
| 200,000     | TBD                        | TBD                | TBD                        | TBD                     | TBD                   |

## Known limitations of this tooling

- The synthetic corpus has a small, fixed vocabulary (8 products, 8 customers, 8 cities, 6 sentence
  templates) — real embeddings/full-text relevance at scale depends on vocabulary diversity this
  generator doesn't provide. It's enough to exercise throughput and index-size scaling; it is
  **not** a substitute for testing retrieval quality against a real corpus.
- `ingest-corpus.mjs` measures text-extraction throughput (what `POST /documents/:id/ingest`
  actually waits for), not embedding-completion throughput — see the script's own header comment.
  Don't read its docs/s number as "how fast the corpus becomes searchable."
- Neo4j's row in the capacity table is unfilled for a real reason (see above), not an oversight.
