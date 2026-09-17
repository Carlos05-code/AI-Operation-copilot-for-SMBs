/**
 * The single request mix shared by smoke/soak/spike (TESTING_SPEC §6) — only the
 * `options` (VUs/duration/stages) differ per scenario file. Weighted toward reads,
 * since that's the real traffic shape (API_SPEC §11.10/§11.11), with one write path
 * (`POST /invoices`) deliberately included: creating drafts concurrently exercises
 * the per-org invoice-numbering retry-on-collision path (API_SPEC §11.12) under
 * exactly the kind of contention a resilience test exists to find.
 *
 * Excluded on purpose: `POST /api/v1/chat` — it 503s as `LLM_UNAVAILABLE` whenever
 * no LLM provider is configured (API_SPEC §11.5), which most load-test targets
 * won't have; mixing it in would poison the error-rate threshold for reasons
 * having nothing to do with the API's own capacity.
 */
import http, { RefinedResponse, ResponseType } from 'k6/http';
import { check, sleep } from 'k6';
import { loadConfig } from './config.ts';
import { authHeaders } from './auth.ts';

type Res = RefinedResponse<ResponseType | undefined>;

function checkOk(res: Res, name: string): void {
  check(res, { [`${name}: status is 2xx`]: (r) => r.status >= 200 && r.status < 300 }, { name });
}

function getDashboardSummary(config: ReturnType<typeof loadConfig>): void {
  const res = http.get(`${config.baseUrl}/api/v1/dashboard/summary`, {
    headers: authHeaders(),
    tags: { name: 'GetDashboardSummary' },
  });
  checkOk(res, 'GetDashboardSummary');
}

function listTodoTasks(config: ReturnType<typeof loadConfig>): void {
  const res = http.get(`${config.baseUrl}/api/v1/tasks?status=TODO`, {
    headers: authHeaders(),
    tags: { name: 'ListTodoTasks' },
  });
  checkOk(res, 'ListTodoTasks');
}

function search(config: ReturnType<typeof loadConfig>): void {
  const res = http.post(
    `${config.baseUrl}/api/v1/search`,
    JSON.stringify({ query: 'winter stock levels', limit: 10 }),
    { headers: authHeaders(), tags: { name: 'Search' } },
  );
  // Search degrades to a 200 with empty results rather than erroring whenever a
  // retrieval store is merely unconfigured (API_SPEC §11.2); only a full outage of
  // every store 503s, so treat that as a genuine failure worth counting.
  checkOk(res, 'Search');
}

function createInvoice(config: ReturnType<typeof loadConfig>): void {
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = http.post(
    `${config.baseUrl}/api/v1/invoices`,
    JSON.stringify({
      customerId: config.customerId,
      items: [{ description: 'Load test line item', quantity: 1, unitPrice: 9.99, taxRate: 0 }],
      dueDate,
      note: 'k6 load test — safe to ignore/delete',
      issue: false,
    }),
    { headers: authHeaders(), tags: { name: 'CreateInvoice' } },
  );
  if (res.status < 200 || res.status >= 300) {
    console.error(`DEBUG CreateInvoice failed: status=${res.status} body=${res.body}`);
  }
  checkOk(res, 'CreateInvoice');
}

function healthLive(config: ReturnType<typeof loadConfig>): void {
  const res = http.get(`${config.baseUrl}/api/v1/health/live`, { tags: { name: 'HealthLive' } });
  checkOk(res, 'HealthLive');
}

/** Cumulative weights out of 100 — first match wins. */
const WEIGHTED_ACTIONS: [number, (config: ReturnType<typeof loadConfig>) => void][] = [
  [10, healthLive],
  [45, getDashboardSummary],
  [70, listTodoTasks],
  [85, search],
  [100, createInvoice],
];

export function mixedWorkload(): void {
  const config = loadConfig();
  const roll = Math.random() * 100;
  for (const [ceiling, action] of WEIGHTED_ACTIONS) {
    if (roll < ceiling) {
      action(config);
      break;
    }
  }
  // Think time — a real user doesn't fire requests back to back.
  sleep(Math.random() * 2 + 1);
}
