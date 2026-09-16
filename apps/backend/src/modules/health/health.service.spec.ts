/**
 * Unit tests — health service dependency probing.
 */
import { HealthService } from './health.service.js';
import type { PrismaService } from '../database/prisma.service.js';

describe('HealthService', () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it('reports ok with unset dependencies as not_configured (not a degradation)', async () => {
    delete process.env.DATABASE_URL;
    const service = new HealthService(undefined);
    const report = await service.report();
    expect(report.status).toBe('ok');
    expect(report.dependencies).toContainEqual({ name: 'postgres', status: 'not_configured' });
    expect(report.dependencies).toContainEqual({ name: 'redis', status: 'not_configured' });
  });

  it('reports configured (not not_configured) once a dependency env var is set', async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';
    try {
      const service = new HealthService(undefined);
      const report = await service.report();
      expect(report.dependencies).toContainEqual({ name: 'redis', status: 'configured' });
    } finally {
      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalRedisUrl;
      }
    }
  });

  it('probes postgres when DATABASE_URL is set and reachable', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/smb_copilot';
    const prisma = { ping: jest.fn().mockResolvedValue(undefined) } as unknown as PrismaService;
    const service = new HealthService(prisma);
    const report = await service.report();
    expect(report.status).toBe('ok');
    expect(report.dependencies[0]).toEqual({ name: 'postgres', status: 'ok' });
  });

  it('degrades when the postgres probe fails', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/smb_copilot';
    const prisma = {
      ping: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const service = new HealthService(prisma);
    const report = await service.report();
    expect(report.status).toBe('degraded');
    expect(report.dependencies[0]?.status).toBe('unhealthy');
  });
});
