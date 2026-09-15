/**
 * Shared pass/fail bar for every scenario (TESTING_SPEC §6), the same numbers as
 * the production alert thresholds (DEVOPS_SPEC §8,
 * infrastructure/monitoring/prometheus/alerting-rules.yml) — a load test failing
 * exactly where the SLO alerts would fire is the point.
 */
export const sloThresholds = {
  http_req_duration: ['p(95)<800'],
  http_req_failed: ['rate<0.01'],
};
