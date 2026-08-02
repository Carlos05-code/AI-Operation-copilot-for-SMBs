/**
 * Unit tests — error contract mapping (API_SPEC §9) and request context.
 */
import { ApiError, codeForStatus, HttpErrorCode } from '../errors/error-contract.js';
import { RequestContext } from '../context/request-context.js';

describe('codeForStatus', () => {
  it.each([
    [400, HttpErrorCode.VALIDATION_ERROR],
    [401, HttpErrorCode.UNAUTHORIZED],
    [403, HttpErrorCode.FORBIDDEN],
    [404, HttpErrorCode.NOT_FOUND],
    [409, HttpErrorCode.CONFLICT],
    [413, HttpErrorCode.PAYLOAD_TOO_LARGE],
    [422, HttpErrorCode.VALIDATION_FAILED],
    [429, HttpErrorCode.TOO_MANY_REQUESTS],
    [500, HttpErrorCode.INTERNAL_ERROR],
    [418, HttpErrorCode.INTERNAL_ERROR],
  ])('maps %i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('ApiError', () => {
  it('carries code, status, message, and ISO timestamp', () => {
    const error = new ApiError({
      code: HttpErrorCode.NOT_FOUND,
      message: 'Invoice 123 not found',
      status: 404,
      details: { id: '123' },
    });

    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Invoice 123 not found');
    expect(error.details).toEqual({ id: '123' });
    expect(() => new Date(error.timestamp)).not.toThrow();
  });

  it('defaults details to empty object', () => {
    const error = new ApiError({ code: 'X', message: 'm', status: 400 });
    expect(error.details).toEqual({});
  });
});

describe('RequestContext', () => {
  it('is inactive outside a request scope', () => {
    expect(RequestContext.isActive()).toBe(false);
    expect(RequestContext.getId()).toBeUndefined();
  });

  it('binds an id inside run()', () => {
    let captured: string | undefined;
    RequestContext.run('req-123', () => {
      captured = RequestContext.getId();
    });
    expect(captured).toBe('req-123');
    expect(RequestContext.getId()).toBeUndefined();
  });

  it('generates fresh ids', () => {
    const a = RequestContext.newId();
    const b = RequestContext.newId();
    expect(a).not.toBe(b);
  });
});
