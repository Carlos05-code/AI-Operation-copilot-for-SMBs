/**
 * Smoke (TESTING_SPEC §6): 5 VUs for 1 minute. Fast enough to run on every tagged
 * release (and, per its own CI job, on every PR against a locally booted stack) —
 * this is the "did we break something obvious" gate, not a capacity test.
 *
 *   k6 run tests/load/smoke.ts
 *   k6 run -e BASE_URL=https://api-staging.smb-copilot.example.com tests/load/smoke.ts
 */
import { mixedWorkload } from './lib/workload.ts';
import { sloThresholds } from './lib/thresholds.ts';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: sloThresholds,
};

export default mixedWorkload;
