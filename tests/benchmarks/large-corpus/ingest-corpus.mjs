#!/usr/bin/env node
/**
 * Bulk-ingests a directory of documents (generate-corpus.mjs's output, or any
 * directory of .txt files) through the real API pipeline — presign, PUT to MinIO,
 * register, ingest — with bounded concurrency, logging per-document latency to a
 * JSON-lines file for report.mjs to summarize.
 *
 * A plain Node script rather than a k6 scenario (tests/load/ already covers
 * concurrent-user query load) because bulk-loading 200k local files with real
 * filesystem streaming and simple concurrency control is a better fit for Node
 * than k6's init-context-only file access.
 *
 * `POST /documents/:id/ingest` only waits for text extraction (API_SPEC §11.4) —
 * chunking/embedding/Qdrant upsert happens asynchronously afterward on the
 * `ai-jobs` BullMQ queue. This script's throughput number is therefore "how fast
 * can text be extracted and registered," not "how fast is the corpus fully
 * searchable" — watch `queue_jobs_waiting{queue="ai-jobs"}` (already shipped,
 * infrastructure/monitoring/) during and after a run to see the embedding-queue
 * drain lag, which is the real number for "when is this corpus actually
 * queryable." See README.md.
 *
 * Usage:
 *   node ingest-corpus.mjs --dir ./corpus --concurrency 20 \
 *     --base-url http://localhost:3000 --keycloak-url http://localhost:8080
 */
import { readdirSync, readFileSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = {
    dir: './corpus',
    concurrency: 20,
    'base-url': process.env.BASE_URL ?? 'http://localhost:3000',
    'keycloak-url': process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
    realm: process.env.KEYCLOAK_REALM ?? 'smb-copilot',
    'client-id': process.env.KEYCLOAK_CLIENT_ID ?? 'smb-copilot-ui',
    username: process.env.DEMO_USERNAME ?? 'owner@acme-demo.local',
    password: process.env.DEMO_PASSWORD ?? 'changeme',
    log: './results/ingest-log.jsonl',
    limit: 0, // 0 = no limit, ingest every file in --dir
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key in args) {
      const value = argv[i + 1];
      args[key] = Number.isNaN(Number(value)) || value === '' ? value : Number(value);
      i += 1;
    }
  }
  return args;
}

let cachedToken = null;
let expiresAtMs = 0;
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

async function getToken(args) {
  if (cachedToken && Date.now() < expiresAtMs) return cachedToken;
  const url = `${args['keycloak-url']}/realms/${args.realm}/protocol/openid-connect/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: args['client-id'],
      username: args.username,
      password: args.password,
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak login failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  cachedToken = body.access_token;
  expiresAtMs = Date.now() + body.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS;
  return cachedToken;
}

async function ingestOne(args, filePath, fileName) {
  const startedAt = Date.now();
  const token = await getToken(args);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const bytes = readFileSync(filePath);

  const presignRes = await fetch(`${args['base-url']}/api/v1/storage/uploads/presign`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: fileName, contentType: 'text/plain' }),
  });
  if (!presignRes.ok) throw new Error(`presign failed: HTTP ${presignRes.status}`);
  const presign = (await presignRes.json()).data;

  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`MinIO PUT failed: HTTP ${putRes.status}`);

  const registerRes = await fetch(`${args['base-url']}/api/v1/documents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName,
      contentType: 'text/plain',
      sizeBytes: bytes.byteLength,
      storageKey: presign.objectKey,
    }),
  });
  if (!registerRes.ok) throw new Error(`register failed: HTTP ${registerRes.status}`);
  const document = (await registerRes.json()).data;

  const ingestRes = await fetch(`${args['base-url']}/api/v1/documents/${document.id}/ingest`, {
    method: 'POST',
    headers,
  });
  if (!ingestRes.ok) throw new Error(`ingest failed: HTTP ${ingestRes.status}`);

  return { fileName, documentId: document.id, durationMs: Date.now() - startedAt };
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  let active = 0;
  let done = 0;
  const results = [];
  return new Promise((resolve) => {
    function next() {
      if (cursor >= items.length && active === 0) {
        resolve(results);
        return;
      }
      while (active < concurrency && cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        active += 1;
        worker(item)
          .then((r) => results.push({ ok: true, ...r }))
          .catch((error) => results.push({ ok: false, item, error: String(error) }))
          .finally(() => {
            active -= 1;
            done += 1;
            if (done % 500 === 0) console.log(`progress: ${done}/${items.length}`);
            next();
          });
      }
    }
    next();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let files = readdirSync(args.dir).filter((f) => f.endsWith('.txt'));
  if (args.limit > 0) files = files.slice(0, args.limit);

  mkdirSync('./results', { recursive: true });
  console.log(
    `ingesting ${files.length} documents from ${args.dir} (concurrency=${args.concurrency})`,
  );

  const startedAt = Date.now();
  const results = await runPool(files, args.concurrency, async (fileName) => {
    const filePath = join(args.dir, fileName);
    if (!statSync(filePath).isFile()) return { fileName, skipped: true };
    return ingestOne(args, filePath, fileName);
  });
  const elapsedS = (Date.now() - startedAt) / 1000;

  for (const r of results) {
    appendFileSync(args.log, JSON.stringify(r) + '\n');
  }

  const failures = results.filter((r) => !r.ok);
  console.log(
    `\ndone: ${results.length} documents in ${elapsedS.toFixed(1)}s ` +
      `(${(results.length / elapsedS).toFixed(1)} docs/s), ${failures.length} failures`,
  );
  console.log(`log written to ${args.log} — run report.mjs for latency percentiles`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
