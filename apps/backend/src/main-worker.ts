/**
 * Worker bootstrap — the "second bootstrap file with no HTTP listener"
 * `infrastructure/kubernetes/README.md` names as the gap in the API/worker
 * split (DEVOPS_SPEC §3). Loads the exact same `AppModule` `main.ts` does —
 * every `@Processor` this app has is a provider somewhere in that module
 * tree, registered identically here — but via `createApplicationContext`,
 * which builds the DI graph without an HTTP adapter. No REST API runs here,
 * on purpose: `AppModule` bundles each feature module's controller and its
 * workers together (`task.module.ts` is typical — one module, one
 * controller, two workers), so bootstrapping it with a real HTTP adapter
 * would wire up the entire REST API a second time, not just the workers.
 * Splitting every such module into an HTTP half and a worker half is the
 * real, clean fix and a materially larger change (BACKEND_SPEC-level
 * module restructuring) than this deployment split — not done here.
 *
 * BullMQ consumers on the same queue name are exactly how you scale worker
 * capacity (Redis-backed per-job locking makes concurrent consumers safe by
 * design) — so this doesn't replace the `api` Deployment's in-process
 * processing, it adds independently scalable capacity alongside it. Both
 * `api` and `worker` pods consume the same queues.
 *
 * `/metrics` and `/healthz` still need a real listener (Prometheus has to
 * scrape *this* process's queue-depth gauge too) — a bare `node:http`
 * server, not Nest's HTTP adapter, since that adapter is exactly what would
 * also wire up every REST controller in `AppModule`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './shared/logger/pino-logger.service.js';
import { setupOpenTelemetry } from './shared/telemetry/telemetry.js';

async function bootstrap(): Promise<void> {
  const telemetry = setupOpenTelemetry();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new PinoLoggerService(),
    bufferLogs: false,
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/metrics') {
      telemetry.metricsHandler(request, response);
      return;
    }
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
      return;
    }
    response.writeHead(404);
    response.end();
  });

  process.on('SIGTERM', () => {
    server.close();
    void app
      .close()
      .then(() => telemetry.shutdown())
      .finally(() => process.exit(0));
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port);
}

void bootstrap();
