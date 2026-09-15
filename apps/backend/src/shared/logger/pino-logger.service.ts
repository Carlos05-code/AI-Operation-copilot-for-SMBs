/**
 * Structured JSON logger (pino) with the request id bound as structured field.
 *
 * Context fields (`requestId`) are attached at emission time. Log levels follow
 * NODE_ENV: development → debug, production → info (BACKEND_SPEC §11).
 *
 * Also binds `traceId`/`spanId` from the active OpenTelemetry span, when one
 * exists (DEVOPS_SPEC §8: "Correlation: trace_id + req_id in all logs") — a
 * log line inside a traced request can be pivoted straight to its trace.
 * `trace.getSpan` returns `undefined` when no SDK is registered (tracing
 * unconfigured, or under test), so this is inert without extra checks.
 *
 * Logs always go to stdout as structured JSON regardless of config. Shipping
 * them to Loki too (DEVOPS_SPEC §8) is an *additional* destination that turns
 * on once `LOKI_URL` names a real instance (`loki.config.ts`) — same
 * on-by-config pattern `setupOpenTelemetry()` uses for traces. `requestId`/
 * `traceId` stay in the log line body, not Loki labels — turning a per-request
 * unique value into a label is exactly the high-cardinality mistake Loki's own
 * docs warn against.
 */
import { Injectable, LoggerService, Optional } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  pino,
  transport,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
  type TransportMultiOptions,
} from 'pino';
import { RequestContext } from '../context/request-context.js';
import { lokiConfig } from './loki.config.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Level for a given NODE_ENV (BACKEND_SPEC §11). */
export function levelForEnv(env = process.env.NODE_ENV): LogLevel {
  return env === 'production' ? 'info' : 'debug';
}

/** Build a fresh Pino logger from `level`. */
export function createPinoLogger(level: LogLevel = levelForEnv()): Logger {
  const options: LoggerOptions = {
    level,
    base: { service: 'smb-copilot-api' },
    redact: {
      paths: ['password', 'secret', 'token', 'authorization'],
      censor: '[REDACTED]',
    },
  };

  const loki = lokiConfig();
  if (!loki) {
    return pino(options);
  }

  const targets: TransportMultiOptions['targets'] = [
    { target: 'pino/file', options: { destination: 1 }, level },
    {
      target: 'pino-loki',
      options: {
        host: loki.host,
        labels: { app: 'smb-copilot-api' },
        // Immediate send, not the default 5s batch — a batch still sitting in
        // memory on an ungraceful shutdown is exactly the last few seconds of
        // logs an incident investigation needs most.
        batching: false,
        // A Loki outage must never take the API down with it (the fail-soft
        // convention every other optional dependency in this app follows).
        silenceErrors: true,
      },
      level,
    },
  ];
  // pino's own types declare `transport()`'s return as `any` (`ThreadStream = any` in
  // pino.d.ts) — not a gap in this code, a gap in pino's own upstream types.
  const destination = transport({ targets }) as DestinationStream;
  return pino(options, destination);
}

@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor(@Optional() logger?: Logger) {
    this.logger = logger ?? createPinoLogger();
  }

  /** Bind the ambient request id and active span's trace/span id, if any. */
  private bind(): Record<string, unknown> | undefined {
    const requestId = RequestContext.getId();
    const spanContext = trace.getActiveSpan()?.spanContext();
    const fields = {
      ...(requestId ? { requestId } : {}),
      ...(spanContext ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}),
    };
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  trace(message: string, ...args: unknown[]): void {
    this.logger.trace(this.bindMessage(message, args));
  }

  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(this.bindMessage(message, args));
  }

  log(message: string, ...args: unknown[]): void {
    this.logger.info(this.bindMessage(message, args));
  }

  info(message: string, ...args: unknown[]): void {
    this.logger.info(this.bindMessage(message, args));
  }

  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(this.bindMessage(message, args));
  }

  error(message: string, ...args: unknown[]): void {
    const meta = this.bind();
    if (args.length > 0 && args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const extra = args[0] as Record<string, unknown>;
      this.logger.error({ ...meta, ...extra }, message);
    } else {
      this.logger.error(meta ?? {}, message);
    }
  }

  private bindMessage(
    message: string,
    args: unknown[],
  ): { msg: string; requestId?: string } & Record<string, unknown> {
    const meta = this.bind() ?? {};
    return { msg: message, ...(args.length > 0 ? { details: args } : {}), ...meta };
  }
}
