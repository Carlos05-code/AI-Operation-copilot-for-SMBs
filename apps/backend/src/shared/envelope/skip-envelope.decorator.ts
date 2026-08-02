/**
 * Marker decorator for handlers that must NOT be wrapped in the success
 * envelope (API_SPEC §2.1). Used for non-API artifacts (OpenAPI document,
 * Swagger UI). The envelope interceptor reads this via the Reflector.
 */
import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE = 'skipEnvelope';

export const SkipEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENVELOPE, true);
