/**
 * Records HTTP request duration + count for every route (DEVOPS_SPEC §8).
 *
 * The label is `<Controller>#<handler>`, not the raw URL — path params
 * (invoice/task/product ids, ...) would blow up cardinality otherwise.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { AppMetricsService } from './app-metrics.service.js';

@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  constructor(private readonly metrics: AppMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const http = context.switchToHttp();
    const method = http.getRequest<Request>().method;
    const route = `${context.getClass().name}#${context.getHandler().name}`;

    const record = (statusCode: number): void => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.recordHttpRequest(method, route, statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse<Response>().statusCode),
        error: (error: unknown) => record(errorStatus(error)),
      }),
    );
  }
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : 500;
}
