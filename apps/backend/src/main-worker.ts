/**
 * Worker bootstrap — the "second bootstrap file with no HTTP listener"
 * `infrastructure/kubernetes/README.md` names as the gap in the API/worker
 * split (DEVOPS_SPEC §3). Loads `WorkerAppModule` (`worker-app.module.ts`),
 * not `AppModule` — every feature module that used to bundle a controller
 * and its BullMQ workers together (`task.module.ts` was the typical
 * example) is now split into an HTTP half and a worker half; this process
 * only ever imports the worker halves, so no `@Controller` class is
 * reachable from its module tree at all, via `createApplicationContext`,
 * which builds the DI graph without an HTTP adapter regardless.
 *
 * BullMQ consumers on the same queue name are exactly how you scale worker
 * capacity (Redis-backed per-job locking makes concurrent consumers safe by
 * design) — so this doesn't replace the `api` Deployment's in-process
 * processing, it adds independently scalable capacity alongside it. Both
 * `api` and `worker` pods consume the same queues.
 *
 * `/metrics` and `/healthz` still need a real listener (Prometheus has to
 * scrape *this* process's queue-depth gauge too) — a bare `node:http`
 * server, not Nest's HTTP adapter, since that adapter would need an
 * `AppModule`-shaped module tree with real controllers to route to.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module.js';
import { PinoLoggerService } from './shared/logger/pino-logger.service.js';
import { setupOpenTelemetry } from './shared/telemetry/telemetry.js';

async function bootstrap(): Promise<void> {
  const telemetry = setupOpenTelemetry();

  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
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
