/**
 * OpenAPI document service — caches the generated 3.1 spec once built.
 * Built by `build()` after app init; served by OpenApiController.
 */
import { Injectable } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

@Injectable()
export class OpenApiService {
  private doc: OpenAPIObject | undefined;

  /** Called at bootstrap after routes are registered (main.ts). */
  setDocument(doc: OpenAPIObject): void {
    this.doc = doc;
  }

  document(): Record<string, unknown> {
    if (!this.doc) {
      throw new Error('OpenAPI document not initialized — call setDocument at bootstrap');
    }
    return this.doc as unknown as Record<string, unknown>;
  }
}
