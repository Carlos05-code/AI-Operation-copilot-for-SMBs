/**
 * OpenTelemetry bootstrap (DEVOPS_SPEC §8, BACKEND_SPEC §14).
 *
 * Auto-instrumentation patches `http`/`express` (via `require`-hooking) at
 * construction time, so it only sees modules required *after* it runs.
 * `npm start` loads `./preload.js` with `node -r` before `main.js`, so this
 * runs before Nest (and therefore `express`) is ever required. Calling it
 * again from `main.ts` is deliberately safe — idempotent via a `globalThis`
 * guard — so telemetry still works (just with the first few requires
 * uninstrumented) if something ever runs `main.js` without the preload flag.
 *
 * Metrics (Prometheus) are always registered: it's a pull model, nothing to
 * fail over if unscraped. Traces need a real collector to push to, so the
 * OTLP exporter and auto-instrumentations are added only when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`otelConfig`) — otherwise this is a
 * metrics-only SDK and `tracingEnabled` is `false`.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { otelConfig } from './otel.config.js';

export interface TelemetryHandle {
  /** True when traces are being pushed to a real OTLP collector. */
  tracingEnabled: boolean;
  /** Mount at `GET /metrics` for Prometheus to scrape. */
  metricsHandler(request: IncomingMessage, response: ServerResponse): void;
  /** Flushes and stops all telemetry (graceful shutdown, BACKEND_SPEC §14). */
  shutdown(): Promise<void>;
}

declare global {
  var __otelTelemetry: TelemetryHandle | undefined;
}

export function setupOpenTelemetry(env: NodeJS.ProcessEnv = process.env): TelemetryHandle {
  if (globalThis.__otelTelemetry) return globalThis.__otelTelemetry;

  const config = otelConfig(env);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config?.serviceName ?? env.OTEL_SERVICE_NAME ?? 'smb-copilot-api',
  });
  const prometheusExporter = new PrometheusExporter({ preventServerStart: true });

  const sdk = new NodeSDK({
    resource,
    metricReader: prometheusExporter,
    ...(config
      ? {
          traceExporter: new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` }),
          instrumentations: [getNodeAutoInstrumentations()],
        }
      : {}),
  });
  sdk.start();

  const handle: TelemetryHandle = {
    tracingEnabled: config !== null,
    metricsHandler: (request, response) =>
      prometheusExporter.getMetricsRequestHandler(request, response),
    shutdown: () => sdk.shutdown(),
  };
  globalThis.__otelTelemetry = handle;
  return handle;
}
