/**
 * Unit tests — TelemetryInterceptor (records duration + labels on success and on error).
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import type { AppMetricsService } from './app-metrics.service';
import { TelemetryInterceptor } from './telemetry.interceptor';

class FakeController {}

function harness() {
  const metrics = { recordHttpRequest: jest.fn() };
  const interceptor = new TelemetryInterceptor(metrics as unknown as AppMetricsService);
  return { interceptor, metrics };
}

function httpContext(overrides: { method?: string; statusCode?: number } = {}): ExecutionContext {
  const request = { method: overrides.method ?? 'GET' };
  const response = { statusCode: overrides.statusCode ?? 200 };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getClass: () => FakeController,
    getHandler: () => function list() {},
  } as unknown as ExecutionContext;
}

describe('TelemetryInterceptor', () => {
  it('records method/route/status on a successful response', (done) => {
    const { interceptor, metrics } = harness();
    const context = httpContext({ method: 'GET', statusCode: 200 });
    const next: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(metrics.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController#list',
          200,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it("records the thrown error's status, defaulting to 500 when it has none", (done) => {
    const { interceptor, metrics } = harness();
    const context = httpContext({ method: 'POST' });
    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    interceptor.intercept(context, next).subscribe({
      error: () => {
        expect(metrics.recordHttpRequest).toHaveBeenCalledWith(
          'POST',
          'FakeController#list',
          500,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records a typed error status (e.g. ApiError-shaped) instead of defaulting', (done) => {
    const { interceptor, metrics } = harness();
    const context = httpContext();
    const apiError = Object.assign(new Error('not found'), { status: 404 });
    const next: CallHandler = { handle: () => throwError(() => apiError) };

    interceptor.intercept(context, next).subscribe({
      error: () => {
        expect(metrics.recordHttpRequest).toHaveBeenCalledWith(
          'GET',
          'FakeController#list',
          404,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('passes non-HTTP contexts straight through without recording', (done) => {
    const { interceptor, metrics } = harness();
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('value') };

    interceptor.intercept(context, next).subscribe({
      next: (value) => expect(value).toBe('value'),
      complete: () => {
        expect(metrics.recordHttpRequest).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
