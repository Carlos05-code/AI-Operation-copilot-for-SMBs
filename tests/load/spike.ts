/**
 * Spike (TESTING_SPEC §6): a sudden ramp up to 1k VUs and back down — tests
 * graceful degradation under a burst (does the HPA (api-hpa.yaml) react in time,
 * do requests queue and recover rather than cascade-fail) rather than sustained
 * capacity. Tag-triggered release CI runs this against a real staging target, not
 * the shared PR runner (see tests/load/README.md) — 1k concurrent logins against
 * a GitHub-hosted runner's Keycloak isn't a realistic capacity signal.
 *
 *   k6 run -e BASE_URL=https://api-staging.smb-copilot.example.com tests/load/spike.ts
 */
import { mixedWorkload } from './lib/workload.ts';
import { sloThresholds } from './lib/thresholds.ts';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1000 },
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  // The spike itself is expected to cause some 5xx/backpressure while the HPA
  // reacts — that's what this scenario exists to observe, so its bar is looser
  // than the steady-state SLO (sloThresholds) smoke/soak hold requests to.
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default mixedWorkload;
