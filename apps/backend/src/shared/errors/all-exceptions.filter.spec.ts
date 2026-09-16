/**
 * Unit tests — AllExceptionsFilter (API_SPEC §9 error envelope).
 *
 * No spec existed for this filter before — exactly why a real bug (every
 * Nest `HttpException`'s response body was double-wrapped as
 * `{ details: { details: {...} } }` instead of `{ details: {...} }`, found by
 * booting the compiled API and curling a 401/404/400) went uncaught.
 */
import { NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ApiError, HttpErrorCode } from './error-contract';
import { RequestContext } from '../context/request-context';

function harness() {
  const filter = new AllExceptionsFilter();
  const json = jest.fn();
  const setHeader = jest.fn().mockReturnThis();
  const status = jest.fn(() => ({ setHeader, json }));
  const response = { status };
  const request = { originalUrl: '/api/v1/widgets' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { filter, host, status, setHeader, json };
}

function envelope(json: jest.Mock): Record<string, unknown> {
  return (json.mock.calls[0]?.[0] as { error: Record<string, unknown> }).error;
}

describe('AllExceptionsFilter', () => {
  it('does not double-wrap a Nest HttpException response body under "details"', () => {
    const { filter, host, json } = harness();
    filter.catch(new UnauthorizedException('nope'), host);
    const error = envelope(json);
    expect(error.details).toEqual({ statusCode: 401, message: 'nope', error: 'Unauthorized' });
  });

  it('maps NotFoundException to status 404 and code NOT_FOUND', () => {
    const { filter, host, status, json } = harness();
    filter.catch(new NotFoundException('Cannot GET /nope'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(envelope(json)).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('maps BadRequestException (ValidationPipe) to status 400 / VALIDATION_ERROR', () => {
    const { filter, host, json } = harness();
    filter.catch(new BadRequestException('bad payload'), host);
    expect(envelope(json)).toMatchObject({ code: 'VALIDATION_ERROR', message: 'bad payload' });
  });

  it('uses an ApiError instance directly, without touching its details', () => {
    const { filter, host, status, json } = harness();
    const error = new ApiError({
      code: HttpErrorCode.CONFLICT,
      status: 409,
      message: 'already exists',
      details: { field: 'sku' },
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(envelope(json)).toMatchObject({
      code: 'CONFLICT',
      message: 'already exists',
      details: { field: 'sku' },
    });
  });

  it('falls back to a generic 500 INTERNAL_ERROR for a plain Error', () => {
    const { filter, host, status, json } = harness();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(envelope(json)).toMatchObject({ code: 'INTERNAL_ERROR', message: 'boom' });
  });

  it('propagates the ambient request id into the envelope and the response header', () => {
    const { filter, host, setHeader, json } = harness();
    RequestContext.run('req-123', () => filter.catch(new NotFoundException('x'), host));
    expect(envelope(json)).toMatchObject({ requestId: 'req-123' });
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-123');
  });

  it('falls back to "unknown" when there is no ambient request id', () => {
    const { filter, host, json } = harness();
    filter.catch(new NotFoundException('x'), host);
    expect(envelope(json)).toMatchObject({ requestId: 'unknown' });
  });
});
