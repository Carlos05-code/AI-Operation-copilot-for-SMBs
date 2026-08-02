/**
 * Per-request correlation id, bound to the async context of a request handler.
 *
 * A middleware seeds it from `X-Request-Id` (or creates one) so logs, error
 * envelopes, and downstream calls carry the same id (API_SPEC §9 `requestId`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type RequestScope = { requestId: string };

const storage = new AsyncLocalStorage<RequestScope>();

export const RequestContext = {
  /** Run `fn` with a request scope; typically called once per HTTP request. */
  run(requestId: string, fn: () => void): void {
    storage.run({ requestId }, fn);
  },

  /** Id of the current request, if any. */
  getId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /** True when executing inside a request scope. */
  isActive(): boolean {
    return storage.getStore() !== undefined;
  },

  /** Fresh random id (matches standard request-id shape). */
  newId(): string {
    return randomUUID();
  },
};
