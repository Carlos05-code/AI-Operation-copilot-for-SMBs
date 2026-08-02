/**
 * Structured JSON logger (pino) with the request id bound as structured field.
 *
 * Context fields (`requestId`) are attached at emission time. Log levels follow
 * NODE_ENV: development → debug, production → info (BACKEND_SPEC §11).
 */
import { Injectable, LoggerService, Optional } from '@nestjs/common';
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

  /** Bind the ambient request id (if any) as `requestId`. */
  private bind(): Record<string, unknown> | undefined {
    const requestId = RequestContext.getId();
    return requestId ? { requestId } : undefined;
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
