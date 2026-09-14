/**
 * Unit tests — ExecutiveBriefingService (read surface + generate trigger).
 */
import type { PrismaService } from '../database/prisma.service';
import type { QueueService } from '../queue/queue.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { ExecutiveBriefingService } from './executive-briefing.service';

function briefingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'brief-1',
    organizationId: 'org-1',
    summary: 'All quiet this week.',
    highlights: [],
    risks: [],
    focusAreas: [],
    signals: {},
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    executiveBriefing: {
      findMany: jest.fn().mockResolvedValue([briefingRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(briefingRow()),
    },
  };
  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') };
  const service = new ExecutiveBriefingService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  );
  return { service, prisma, queue };
}

describe('ExecutiveBriefingService.list/get/latest', () => {
  it('lists org-scoped briefings, newest first', async () => {
    const { service, prisma } = harness();
    const result = await service.list('org-1', 1, 20);
    expect(prisma.executiveBriefing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result.total).toBe(1);
  });

  it('404s an unknown or foreign briefing', async () => {
    const { service, prisma } = harness();
    prisma.executiveBriefing.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'brief-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('404s latest when none exist yet', async () => {
    const { service, prisma } = harness();
    prisma.executiveBriefing.findFirst.mockResolvedValue(null);
    await expect(service.latest('org-1')).rejects.toMatchObject({ status: 404 });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new ExecutiveBriefingService(undefined, undefined);
    await expect(service.list('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});

describe('ExecutiveBriefingService.requestGenerate', () => {
  it('enqueues the briefing job scoped to the org', async () => {
    const { service, queue } = harness();
    await service.requestGenerate('org-1');
    expect(queue.enqueue).toHaveBeenCalledWith('ai-jobs', 'insight.executive.briefing', {
      organizationId: 'org-1',
    });
  });

  it('swallows a queue failure', async () => {
    const { service, queue } = harness();
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.requestGenerate('org-1')).resolves.toBeUndefined();
  });

  it('is a no-op with no queue configured', async () => {
    const service = new ExecutiveBriefingService(
      { executiveBriefing: {} } as unknown as PrismaService,
      undefined,
    );
    await expect(service.requestGenerate('org-1')).resolves.toBeUndefined();
  });
});
