/**
 * Error codes for the standard API error contract (API_SPEC §9).
 *
 * The code identifies the failure class independent of HTTP status so clients
 * can branch on a stable string. Map status → code at the boundary only.
 */
export const HttpErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  UNSUPPORTED_DOCUMENT: 'UNSUPPORTED_DOCUMENT',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  EMBEDDINGS_UNAVAILABLE: 'EMBEDDINGS_UNAVAILABLE',
  VECTOR_STORE_UNAVAILABLE: 'VECTOR_STORE_UNAVAILABLE',
  SEARCH_UNAVAILABLE: 'SEARCH_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type HttpErrorCodeName = (typeof HttpErrorCode)[keyof typeof HttpErrorCode];

/** Maps the standard HTTP status codes to their canonical error code. */
export function codeForStatus(status: number): HttpErrorCodeName {
  switch (status) {
    case 400:
      return HttpErrorCode.VALIDATION_ERROR;
    case 401:
      return HttpErrorCode.UNAUTHORIZED;
    case 403:
      return HttpErrorCode.FORBIDDEN;
    case 404:
      return HttpErrorCode.NOT_FOUND;
    case 409:
      return HttpErrorCode.CONFLICT;
    case 413:
      return HttpErrorCode.PAYLOAD_TOO_LARGE;
    case 422:
      return HttpErrorCode.VALIDATION_FAILED;
    case 429:
      return HttpErrorCode.TOO_MANY_REQUESTS;
    default:
      return HttpErrorCode.INTERNAL_ERROR;
  }
}

/** Body shape accepted by the JSON error contract (API_SPEC §9). */
export interface ApiErrorInput {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  requestId: string;
  path: string;
  timestamp: string;
}

/** A typed, serializable domain error. Carries no transport coupling. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string;
  readonly path: string;
  readonly timestamp: string;

  constructor(input: Omit<ApiErrorInput, 'timestamp' | 'requestId' | 'path'>) {
    super(input.message);
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? {};
    this.requestId = '';
    this.path = '';
    this.timestamp = new Date().toISOString();
    this.name = 'ApiError';
  }
}
