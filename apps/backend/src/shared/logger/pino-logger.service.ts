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
 */
import { Injectable, LoggerService, Optional } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { pino, type Logger, type LoggerOptions } from 'pino';
import { RequestContext } from '../context/request-context.js';

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
  return pino(options);
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
