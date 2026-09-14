/**
 * Unit tests — PurchaseRecommendationService (read surface + lifecycle).
 */
import type { PrismaService } from '../database/prisma.service';
import type { QueueService } from '../queue/queue.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { PurchaseRecommendationService } from './purchase-recommendation.service';

function recommendationRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec-1',
    organizationId: 'org-1',
    productId: 'prod-1',
    recommendedQuantity: 50,
    reason: 'Cover 30 days of demand',
    status: 'PENDING',
    agentMetadata: { promptVersion: 'recommend.reorder.v1' },
    resolvedAt: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    purchaseRecommendation: {
      findMany: jest.fn().mockResolvedValue([recommendationRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(recommendationRow()),
      update: jest.fn().mockResolvedValue(recommendationRow({ status: 'ORDERED' })),
    },
  };
  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') };
  const service = new PurchaseRecommendationService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  );
  return { service, prisma, queue };
}

describe('PurchaseRecommendationService.list/get', () => {
  it('lists org-scoped recommendations, pending first', async () => {
    const { service, prisma } = harness();
    const result = await service.list('org-1', 1, 20, { status: 'PENDING' as never });
    expect(prisma.purchaseRecommendation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', status: 'PENDING' },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
    );
    expect(result.total).toBe(1);
  });

  it('404s an unknown or foreign recommendation', async () => {
    const { service, prisma } = harness();
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'rec-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new PurchaseRecommendationService(undefined, undefined);
    await expect(service.list('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});

describe('PurchaseRecommendationService lifecycle', () => {
  it('marks a pending recommendation ordered', async () => {
    const { service, prisma } = harness();
    const view = await service.markOrdered('org-1', 'rec-1');
    expect(prisma.purchaseRecommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({ status: 'ORDERED', resolvedAt: expect.any(Date) }),
      }),
    );
    expect(view.status).toBe('ORDERED');
  });

  it('dismisses a pending recommendation', async () => {
    const { service, prisma } = harness();
    await service.dismiss('org-1', 'rec-1');
    expect(prisma.purchaseRecommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISMISSED' }) }),
    );
  });

  it('rejects resolving an already-resolved recommendation with 409', async () => {
    const { service, prisma } = harness();
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(
      recommendationRow({ status: 'ORDERED' }),
    );
    await expect(service.dismiss('org-1', 'rec-1')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      status: 409,
    });
    expect(prisma.purchaseRecommendation.update).not.toHaveBeenCalled();
  });
});

describe('PurchaseRecommendationService.requestRecommend', () => {
  it('enqueues the sweep job on the ai-jobs queue', async () => {
    const { service, queue } = harness();
    await service.requestRecommend();
    expect(queue.enqueue).toHaveBeenCalledWith('ai-jobs', 'purchase.recommend.sweep', {});
  });

  it('swallows a queue failure', async () => {
    const { service, queue } = harness();
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.requestRecommend()).resolves.toBeUndefined();
  });

  it('is a no-op with no queue configured', async () => {
    const service = new PurchaseRecommendationService(
      { purchaseRecommendation: {} } as unknown as PrismaService,
      undefined,
    );
    await expect(service.requestRecommend()).resolves.toBeUndefined();
  });
});
