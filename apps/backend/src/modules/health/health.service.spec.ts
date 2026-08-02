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

  it('reports ok with all dependencies configured when no DATABASE_URL is set', async () => {
    delete process.env.DATABASE_URL;
    const service = new HealthService(undefined);
    const report = await service.report();
    expect(report.status).toBe('ok');
    expect(report.dependencies).toContainEqual({ name: 'postgres', status: 'configured' });
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
