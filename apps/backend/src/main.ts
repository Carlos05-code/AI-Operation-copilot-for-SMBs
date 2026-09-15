/**
 * Bootstrap: creates the Nest application, applies global conventions
 * (version prefix `/api/v1`, validation pipe), generates OpenAPI, and serves.
 *
 * `setupOpenTelemetry()` (BACKEND_SPEC §14) really needs to run via the
 * `-r ./dist/shared/telemetry/preload.js` flag on the `start`/`start:dev`
 * scripts, before this file is required — but it's idempotent, so calling it
 * again here is a safe fallback for anything that runs `main.js` directly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { OpenApiService } from './shared/openapi/openapi.service.js';
import { buildOpenApiDocument } from './shared/openapi/openapi-document.js';
import { PinoLoggerService } from './shared/logger/pino-logger.service.js';
import { setupOpenTelemetry } from './shared/telemetry/telemetry.js';

async function bootstrap(): Promise<void> {
  const telemetry = setupOpenTelemetry();

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

  // Prometheus scrape target (DEVOPS_SPEC §8) — mounted below the global
  // prefix/versioning so it stays at the conventional `/metrics`, not
  // `/api/v1/metrics`. Express's request/response are structurally Node's
  // `IncomingMessage`/`ServerResponse` at runtime; the cast just papers over
  // a type-only mismatch between the two `@types` packages.
  app.getHttpAdapter().get('/metrics', (request: unknown, response: unknown) => {
    telemetry.metricsHandler(request as IncomingMessage, response as ServerResponse);
  });

  // Graceful shutdown (BACKEND_SPEC §14): stop accepting connections, then
  // flush any buffered spans before the process actually exits.
  process.on('SIGTERM', () => {
    void app
      .close()
      .then(() => telemetry.shutdown())
      .finally(() => process.exit(0));
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
