/**
 * Bootstrap: creates the Nest application, applies global conventions
 * (version prefix `/api/v1`, validation pipe), generates OpenAPI, and serves.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { OpenApiService } from './shared/openapi/openapi.service.js';
import { buildOpenApiDocument } from './shared/openapi/openapi-document.js';
import { PinoLoggerService } from './shared/logger/pino-logger.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new PinoLoggerService(),
    bufferLogs: false,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // CORS_ORIGIN: comma-separated allowlist for browser clients (SECURITY_SPEC
  // §6). Unset reflects the request Origin (open by default for local/dev —
  // the API is bearer-token authenticated, not cookie-based, so this is not a
  // credentialed-CORS risk); set it in production to the deployed UI origin(s).
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const openApi = app.get(OpenApiService);
  openApi.setDocument(buildOpenApiDocument(app));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
