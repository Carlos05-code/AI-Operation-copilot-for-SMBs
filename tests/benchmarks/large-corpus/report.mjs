#!/usr/bin/env node
/**
 * Summarizes an ingest-corpus.mjs JSON-lines log into throughput + latency
 * percentiles. Usage: node report.mjs --log ./results/ingest-log.jsonl
 */
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { log: './results/ingest-log.jsonl' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key in args) {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const lines = readFileSync(args.log, 'utf8').trim().split('\n').filter(Boolean);
  const rows = lines.map((line) => JSON.parse(line));

  const ok = rows.filter((r) => r.ok);
  const failed = rows.filter((r) => !r.ok);
  const durations = ok.map((r) => r.durationMs).sort((a, b) => a - b);

  console.log(`total: ${rows.length}, succeeded: ${ok.length}, failed: ${failed.length}`);
  if (durations.length > 0) {
    console.log(
      `ingest latency (ms): p50=${percentile(durations, 50)} p90=${percentile(durations, 90)} ` +
        `p95=${percentile(durations, 95)} p99=${percentile(durations, 99)} max=${durations[durations.length - 1]}`,
    );
  }
  if (failed.length > 0) {
    const byError = {};
    for (const f of failed) byError[f.error] = (byError[f.error] ?? 0) + 1;
    console.log('failures by error:');
    for (const [error, count] of Object.entries(byError)) console.log(`  ${count}x  ${error}`);
  }
}

main();
