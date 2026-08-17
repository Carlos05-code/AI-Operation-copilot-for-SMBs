/**
 * Redis connection options for BullMQ (ADR-0013).
 *
 * Parses `redis://[user]:[password@]host:port[/db]` (ioredis-compatible) into
 * the named options BullMQ expects. Unset values fall back to localhost:6379
 * so the app still constructs cleanly without a `.env`.
 *
 * The retry strategy is bounded: BullMQ/ioredis retry forever by default,
 * which makes `Worker.close()` hang during shutdown while Redis is down
 * (`waitUntilReady` never settles). Giving up after ~20s keeps the fail-soft
 * property: the app boots and runs without Redis, and a Redis that appears
 * within the retry window is still picked up.
 */
const DEFAULTS = { host: 'localhost', port: 6379 };
const MAX_RETRY_ATTEMPTS = 15;
const RETRY_BASE_DELAY_MS = 200;
const RETRY_MAX_DELAY_MS = 2000;

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  retryStrategy: (times: number) => number | null;
}

function boundedRetryStrategy(times: number): number | null {
  if (times > MAX_RETRY_ATTEMPTS) return null;
  return Math.min(times * RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS);
}

export function redisConnectionOptions(url?: string): RedisConnectionOptions {
  if (!url) return { ...DEFAULTS, retryStrategy: boundedRetryStrategy };
  const parsed = new URL(url);
  return {
    host: parsed.hostname || DEFAULTS.host,
    port: parsed.port ? Number(parsed.port) : DEFAULTS.port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) || 0 : 0,
    retryStrategy: boundedRetryStrategy,
  };
}
