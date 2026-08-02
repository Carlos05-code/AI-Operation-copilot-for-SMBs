/** OpenAPI feature module. */
import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller.js';
import { OpenApiService } from '../../shared/openapi/openapi.service.js';

@Module({
  controllers: [OpenApiController],
  providers: [OpenApiService],
  exports: [OpenApiService],
})
export class OpenApiModule {}
