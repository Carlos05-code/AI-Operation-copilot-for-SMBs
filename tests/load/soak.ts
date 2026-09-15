/**
 * Soak (TESTING_SPEC §6): ramp to 200 VUs, hold for the bulk of 30 minutes, ramp
 * down — a sustained-load resilience check (connection-pool exhaustion, memory
 * growth, queue backlog under steady write pressure) that a 1-minute smoke test
 * can't surface. Tag-triggered release CI runs this against a real staging target,
 * not the shared PR runner (see tests/load/README.md).
 *
 *   k6 run -e BASE_URL=https://api-staging.smb-copilot.example.com tests/load/soak.ts
 */
import { mixedWorkload } from './lib/workload.ts';
import { sloThresholds } from './lib/thresholds.ts';

export const options = {
  scenarios: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '26m', target: 200 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: sloThresholds,
};

export default mixedWorkload;
