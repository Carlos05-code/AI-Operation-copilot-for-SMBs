/**
 * Unit tests — PinoLoggerService (requestId + traceId/spanId correlation).
 *
 * `context.with()` only actually propagates once a real `ContextManager` is
 * registered — in production that's `NodeSDK.start()`'s job. Registering
 * `AsyncHooksContextManager` here exercises the exact same propagation path
 * production uses, rather than asserting against a mocked `trace` API.
 */
import { context, trace, type Span, type SpanContext } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import type { Logger } from 'pino';
import { RequestContext } from '../context/request-context';
import { PinoLoggerService } from './pino-logger.service';

let contextManager: AsyncHooksContextManager;

beforeAll(() => {
  contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);
});

afterAll(() => {
  contextManager.disable();
});

function harness() {
  const logger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  };
  const service = new PinoLoggerService(logger as unknown as Logger);
  return { service, logger };
}

function withActiveSpan<T>(spanContext: SpanContext, fn: () => T): T {
  const fakeSpan = { spanContext: () => spanContext } as unknown as Span;
  return context.with(trace.setSpan(context.active(), fakeSpan), fn);
}

const SPAN_CONTEXT: SpanContext = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: 1,
};

describe('PinoLoggerService', () => {
  it('binds nothing extra when there is no request id and no active span', () => {
    const { service, logger } = harness();
    service.log('hello');
    expect(logger.info).toHaveBeenCalledWith({ msg: 'hello' });
  });

  it('binds the ambient request id', () => {
    const { service, logger } = harness();
    RequestContext.run('req-1', () => service.log('hello'));
    expect(logger.info).toHaveBeenCalledWith({ msg: 'hello', requestId: 'req-1' });
  });

  it('binds traceId/spanId from the active span', () => {
    const { service, logger } = harness();
    withActiveSpan(SPAN_CONTEXT, () => service.log('hello'));
    expect(logger.info).toHaveBeenCalledWith({
      msg: 'hello',
      traceId: SPAN_CONTEXT.traceId,
      spanId: SPAN_CONTEXT.spanId,
    });
  });

  it('binds requestId and traceId/spanId together on error logs', () => {
    const { service, logger } = harness();
    RequestContext.run('req-1', () => withActiveSpan(SPAN_CONTEXT, () => service.error('boom')));
    expect(logger.error).toHaveBeenCalledWith(
      { requestId: 'req-1', traceId: SPAN_CONTEXT.traceId, spanId: SPAN_CONTEXT.spanId },
      'boom',
    );
  });
});
