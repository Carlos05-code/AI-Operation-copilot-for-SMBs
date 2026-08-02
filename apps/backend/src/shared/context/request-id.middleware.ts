/**
 * Request id middleware: seeds the async context from `X-Request-Id` (or a
 * fresh uuid) and echoes it on the response. Runs before controller handling.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id =
      incoming && /^[0-9a-fA-F-]{8,64}$/.test(incoming) ? incoming : RequestContext.newId();

    res.setHeader('X-Request-Id', id);

    // Bind the async context for the whole request lifecycle.
    RequestContext.run(id, () => next());
  }
}
