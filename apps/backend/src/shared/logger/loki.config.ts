/**
 * Loki log-shipping configuration (DEVOPS_SPEC §8).
 *
 * Logs are always structured JSON on stdout regardless of this — Loki shipping is
 * an *additional* destination, off by default, on once `LOKI_URL` names a real
 * Loki instance. Same on/off-by-config pattern as tracing (`otel.config.ts`).
 */
export interface LokiConfig {
  host: string;
}

/** Resolves the Loki config; `null` when no Loki instance is configured. */
export function lokiConfig(env: NodeJS.ProcessEnv = process.env): LokiConfig | null {
  const host = env.LOKI_URL;
  if (!host) return null;
  return { host: host.replace(/\/+$/, '') };
}
