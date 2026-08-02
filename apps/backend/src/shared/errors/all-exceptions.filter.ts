/**
 * Global exception filter: converts any thrown error into the standard API
 * error envelope (API_SPEC §9) and propagates the request id.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLoggerService } from '../logger/pino-logger.service.js';
import { RequestContext } from '../context/request-context.js';
import { ApiError, codeForStatus, HttpErrorCode } from './error-contract.js';

/** Serialized body conforming to the documented error contract (API_SPEC §9). */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    status: number;
    details: Record<string, unknown>;
    path: string;
    timestamp: string;
    requestId: string;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Optional() private readonly logger?: PinoLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Unexpected error';
    let code: string = HttpErrorCode.INTERNAL_ERROR;
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.message === 'string') {
          message = record.message;
        }
        details = { details: record };
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const requestId = RequestContext.getId() ?? 'unknown';
    const envelope: ErrorEnvelope = {
      error: {
        code,
        message,
        status,
        details,
        path: request.originalUrl,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };

    if (status >= 500 && this.logger) {
      this.logger.error(`[error] ${code}`, { message, requestId, path: request.originalUrl });
    }

    response.status(status).setHeader('X-Request-Id', requestId).json(envelope);
  }
}
