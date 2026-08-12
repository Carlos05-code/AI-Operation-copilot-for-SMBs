/**
 * Redis connection options for BullMQ (ADR-0013).
 *
 * Parses `redis://[user]:[password@]host:port[/db]` (ioredis-compatible) into
 * the named options BullMQ expects. Unset values fall back to localhost:6379
 * so the app still constructs cleanly without a `.env`.
 */
import type { ConnectionOptions } from 'bullmq';

const DEFAULTS = { host: 'localhost', port: 6379 };

export function redisConnectionOptions(url?: string): ConnectionOptions {
  if (!url) return DEFAULTS;
  const parsed = new URL(url);
  return {
    host: parsed.hostname || DEFAULTS.host,
    port: parsed.port ? Number(parsed.port) : DEFAULTS.port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) || 0 : 0,
  };
}
