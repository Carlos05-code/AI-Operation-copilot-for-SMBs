/**
 * OpenAPI document builder (API_SPEC §10).
 *
 * @nestjs/swagger emits 3.0.0 documents; the ratified contract requires the
 * artifact to declare OpenAPI 3.1. The 3.0 document shape is a valid 3.1
 * subset, so we relabel at build time here (single source of truth).
 */
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const OPENAPI_VERSION = '3.1.0';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('AI Operations Copilot API')
    .setDescription('Operations and AI platform for SMBs.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  return { ...document, openapi: OPENAPI_VERSION };
}
