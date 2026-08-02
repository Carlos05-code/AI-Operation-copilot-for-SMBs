/**
 * Serves the generated OpenAPI 3.1 document at `GET /api/v1/openapi.json`
 * (ADR-0003, API_SPEC §10). The document is derived from decorators at boot.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OpenApiService } from '../../shared/openapi/openapi.service.js';
import { SkipEnvelope } from '../../shared/envelope/skip-envelope.decorator.js';

@Controller('openapi.json')
@ApiExcludeController()
@SkipEnvelope()
export class OpenApiController {
  constructor(private readonly openApiService: OpenApiService) {}

  @Get()
  document(): Record<string, unknown> {
    return this.openApiService.document();
  }
}
