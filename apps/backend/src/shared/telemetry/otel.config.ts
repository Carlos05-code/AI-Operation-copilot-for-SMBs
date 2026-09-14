/**
 * OpenTelemetry tracing configuration (DEVOPS_SPEC §8, BACKEND_SPEC §14).
 *
 * Prometheus metrics are always on (a pull-based scrape needs no external
 * target to reach). Traces must be *pushed* somewhere, so they stay off —
 * `setupOpenTelemetry()` skips the trace exporter and auto-instrumentation —
 * until `OTEL_EXPORTER_OTLP_ENDPOINT` names a real collector.
 */
export interface OtelConfig {
  otlpEndpoint: string;
  serviceName: string;
}

/** Resolves the tracing config; `null` when no OTLP collector is configured. */
export function otelConfig(env: NodeJS.ProcessEnv = process.env): OtelConfig | null {
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otlpEndpoint) return null;
  return {
    otlpEndpoint: otlpEndpoint.replace(/\/+$/, ''),
    serviceName: env.OTEL_SERVICE_NAME || 'smb-copilot-api',
  };
}
