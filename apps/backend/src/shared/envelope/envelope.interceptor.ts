/**
 * Success envelope interceptor (API_SPEC §2.1).
 *
 * Wraps every success response in `{ data, meta: { requestId } }`. Handlers
 * marked with `@SkipEnvelope()` pass through unwrapped (e.g. OpenAPI docs).
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { Response } from 'express';
import { RequestContext } from '../context/request-context.js';
import { SKIP_ENVELOPE } from './skip-envelope.decorator.js';

export interface SuccessEnvelope<T> {
  data: T;
  meta: { requestId: string; statusCode: number };
}

@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<unknown>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<unknown>> {
    const skip =
      this.reflector.get<boolean>(SKIP_ENVELOPE, context.getHandler()) ??
      this.reflector.get<boolean>(SKIP_ENVELOPE, context.getClass()) ??
      false;

    if (skip) {
      return next.handle() as Observable<SuccessEnvelope<unknown>>;
    }

    return next.handle().pipe(
      map((payload) => {
        const http = context.switchToHttp();
        const response = http.getResponse<Response>();
        const statusCode = response.statusCode;
        const requestId = RequestContext.getId() ?? 'unknown';
        return { data: payload, meta: { requestId, statusCode } };
      }),
    );
  }
}
