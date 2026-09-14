/**
 * Unit tests — PurchaseRecommendationWorker (signals, demand trend, LLM
 * recommendations, dedupe, notify, per-org fail-soft).
 */
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { PurchaseRecommendationWorker } from './purchase-recommendation.worker';

function harness(
  overrides: {
    llm?: { isConfigured: boolean; complete: jest.Mock };
  } = {},
) {
  const prisma = {
    product: { findMany: jest.fn() },
    inventoryMovement: { groupBy: jest.fn() },
    purchaseRecommendation: { findFirst: jest.fn(), create: jest.fn() },
    member: { findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const llm = overrides.llm ?? { isConfigured: true, complete: jest.fn() };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new PurchaseRecommendationWorker(
    { isConfigured: llm.isConfigured, complete: llm.complete } as unknown as LlmProvider,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, llm, outbox };
}

const job = (overrides: Partial<Job> = {}): Job =>
  ({ name: 'purchase.recommend.sweep', ...overrides }) as unknown as Job;

function oneCandidate(
  prisma: { product: { findMany: jest.Mock }; inventoryMovement: { groupBy: jest.Mock } },
  opts: { last?: number; prior?: number } = {},
): void {
  const last = opts.last ?? 15;
  const prior = opts.prior ?? 10;
  prisma.product.findMany.mockResolvedValue([
    {
      id: 'prod-1',
      organizationId: 'org-1',
      name: 'Espresso Beans 1kg',
      sku: 'COF-001',
      reorderPoint: 20,
    },
  ]);
  prisma.inventoryMovement.groupBy
    .mockResolvedValueOnce([{ productId: 'prod-1', type: 'OUT', _sum: { quantity: last + prior } }])
    .mockResolvedValueOnce([{ productId: 'prod-1', _sum: { quantity: last } }])
    .mockResolvedValueOnce([{ productId: 'prod-1', _sum: { quantity: prior } }]);
}

describe('PurchaseRecommendationWorker', () => {
  it('creates a recommendation from LLM output and notifies alert-role members', async () => {
    const { worker, prisma, llm, outbox } = harness();
    oneCandidate(prisma, { last: 15, prior: 10 });
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    prisma.purchaseRecommendation.create.mockResolvedValue({ id: 'rec-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({
        recommendations: [{ productId: 'prod-1', quantity: 50, reason: 'Cover 30 days of demand' }],
      }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ ran: true, candidates: 1, created: 1, duplicates: 0 });
    expect(llm.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('trend: increasing'),
      expect.any(Number),
    );
    expect(prisma.purchaseRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          productId: 'prod-1',
          recommendedQuantity: 50,
          reason: 'Cover 30 days of demand',
          agentMetadata: expect.objectContaining({
            promptVersion: 'recommend.reorder.v2',
            consumedLast30Days: 15,
            consumedPriorPeriodDays: 10,
            trend: 'increasing',
          }),
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            organizationId: 'org-1',
            userId: 'user-1',
            title: 'Reorder 50 × Espresso Beans 1kg',
          }),
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'purchase.recommended',
        payload: expect.objectContaining({ created: 1, duplicates: 0 }),
      }),
    );
    expect(result.notified).toBe(1);
  });

  it.each([
    [15, 10, 'increasing'],
    [10, 15, 'decreasing'],
    [10, 11, 'stable'],
    [5, 0, 'increasing'],
    [0, 0, 'stable'],
  ])('classifies last=%d vs prior=%d as %s', async (last, prior, trend) => {
    const { worker, prisma, llm } = harness();
    oneCandidate(prisma, { last, prior });
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    prisma.purchaseRecommendation.create.mockResolvedValue({ id: 'rec-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({ recommendations: [{ productId: 'prod-1', quantity: 10, reason: 'x' }] }),
    );

    await worker.process(job());

    const data = prisma.purchaseRecommendation.create.mock.calls[0][0].data;
    expect(data.agentMetadata.trend).toBe(trend);
  });

  it('dedupes against a still-PENDING recommendation for the same product', async () => {
    const { worker, prisma, llm } = harness();
    oneCandidate(prisma);
    prisma.purchaseRecommendation.findFirst.mockResolvedValue({ id: 'existing' });
    llm.complete.mockResolvedValue(
      JSON.stringify({ recommendations: [{ productId: 'prod-1', quantity: 50, reason: 'x' }] }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ created: 0, duplicates: 1 });
    expect(prisma.purchaseRecommendation.create).not.toHaveBeenCalled();
  });

  it('ignores a recommendation whose productId is not in the signal set', async () => {
    const { worker, prisma, llm } = harness();
    oneCandidate(prisma);
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    llm.complete.mockResolvedValue(
      JSON.stringify({
        recommendations: [{ productId: 'ghost-product', quantity: 10, reason: 'x' }],
      }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ created: 0, duplicates: 0 });
    expect(prisma.purchaseRecommendation.create).not.toHaveBeenCalled();
  });

  it('skips when there are no below-reorder-point products, no database, or no LLM', async () => {
    const { worker, prisma } = harness();
    prisma.product.findMany.mockResolvedValue([]);
    await expect(worker.process(job())).resolves.toMatchObject({ ran: true, candidates: 0 });

    const noDb = new PurchaseRecommendationWorker(
      { isConfigured: true } as unknown as LlmProvider,
      undefined,
      undefined,
    );
    await expect(noDb.process(job())).resolves.toMatchObject({ skipped: 'not configured' });

    const { worker: worker2, prisma: prisma2 } = harness({
      llm: { isConfigured: false, complete: jest.fn() },
    });
    oneCandidate(prisma2);
    await expect(worker2.process(job())).resolves.toMatchObject({ skipped: 'llm not configured' });
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'conversation.embed' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('continues to the next org when one org returns malformed model output', async () => {
    const { worker, prisma, llm } = harness();
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', organizationId: 'org-1', name: 'Beans', sku: 'A', reorderPoint: 10 },
      { id: 'prod-2', organizationId: 'org-2', name: 'Mugs', sku: 'B', reorderPoint: 10 },
    ]);
    prisma.inventoryMovement.groupBy.mockResolvedValue([]);
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    prisma.purchaseRecommendation.create.mockResolvedValue({ id: 'rec-1' });
    llm.complete
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(
        JSON.stringify({ recommendations: [{ productId: 'prod-2', quantity: 5, reason: 'x' }] }),
      );

    const result = await worker.process(job());

    expect(result).toMatchObject({ ran: true, candidates: 2, created: 1 });
  });

  it('swallows outbox failures after persisting', async () => {
    const { worker, prisma, llm, outbox } = harness();
    oneCandidate(prisma);
    prisma.purchaseRecommendation.findFirst.mockResolvedValue(null);
    prisma.purchaseRecommendation.create.mockResolvedValue({ id: 'rec-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({ recommendations: [{ productId: 'prod-1', quantity: 10, reason: 'x' }] }),
    );
    outbox.append.mockRejectedValue(new Error('db down'));

    await expect(worker.process(job())).resolves.toMatchObject({ ran: true, created: 1 });
  });
});
