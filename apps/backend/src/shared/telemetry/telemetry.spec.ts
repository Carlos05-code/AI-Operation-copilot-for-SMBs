/**
 * Unit tests — setupOpenTelemetry (metrics-always-on, traces gated,
 * idempotency). Runs the real SDK against a loopback HTTP server rather
 * than guessing the Prometheus exporter's response-object shape.
 */
import * as http from 'node:http';
import { setupOpenTelemetry, type TelemetryHandle } from './telemetry';

function resetGlobalTelemetry(): void {
  globalThis.__otelTelemetry = undefined;
}

async function fetchMetrics(handle: TelemetryHandle): Promise<{ status: number; body: string }> {
  const server = http.createServer((request, response) => handle.metricsHandler(request, response));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  try {
    return await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/metrics`, (response) => {
          let body = '';
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        })
        .on('error', reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('setupOpenTelemetry', () => {
  afterEach(() => resetGlobalTelemetry());

  it('is metrics-only (no traces) without an OTLP endpoint, and /metrics responds', async () => {
    const handle = setupOpenTelemetry({});
    expect(handle.tracingEnabled).toBe(false);

    const { status, body } = await fetchMetrics(handle);
    expect(status).toBe(200);
    expect(body).toContain('# HELP');

    await handle.shutdown();
  });

  it('enables tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    const handle = setupOpenTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });
    expect(handle.tracingEnabled).toBe(true);
    await handle.shutdown();
  });

  it('is idempotent — a later call returns the exact same handle, env and all', async () => {
    const first = setupOpenTelemetry({});
    const second = setupOpenTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });

    expect(second).toBe(first);
    expect(second.tracingEnabled).toBe(false);

    await first.shutdown();
  });
});
