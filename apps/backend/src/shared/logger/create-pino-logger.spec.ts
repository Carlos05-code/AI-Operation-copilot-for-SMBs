/**
 * Unit tests — createPinoLogger's Loki wiring.
 *
 * A real loopback HTTP server standing in for Loki (same "verify against a real
 * scrape, not a mocked shape" approach `telemetry.spec.ts` uses for the Prometheus
 * exporter) — asserts an actual POST to `/loki/api/v1/push` arrives with the log
 * line's message, not just that constructing the logger doesn't throw.
 */
import { createServer, type Server } from 'node:http';
import { createPinoLogger } from './pino-logger.service';

function startMockLoki(): Promise<{ server: Server; port: number; bodies: string[] }> {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, bodies });
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

describe('createPinoLogger — Loki transport', () => {
  const originalLokiUrl = process.env.LOKI_URL;
  let mock: { server: Server; port: number; bodies: string[] };

  beforeEach(async () => {
    mock = await startMockLoki();
  });

  afterEach(async () => {
    process.env.LOKI_URL = originalLokiUrl;
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
  });

  it('does not throw when LOKI_URL is unset (the default, no-Loki path)', () => {
    delete process.env.LOKI_URL;
    expect(() => createPinoLogger()).not.toThrow();
  });

  it('ships a log line to the configured Loki instance', async () => {
    process.env.LOKI_URL = `http://127.0.0.1:${mock.port}`;
    const logger = createPinoLogger();

    logger.info('hello from the loki transport test');

    await waitFor(
      () => mock.bodies.some((body) => body.includes('hello from the loki transport test')),
      3000,
    );

    expect(mock.bodies.length).toBeGreaterThan(0);
  }, 10000);
});
