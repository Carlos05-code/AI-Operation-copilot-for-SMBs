/**
 * Unit tests — InventoryReorderWorker (periodic reorder-alert safety net).
 */
import type { Job } from 'bullmq';
import type { PrismaService } from '../database/prisma.service';
import { InventoryReorderWorker } from './inventory.reorder.worker';
import type { InventoryService } from './inventory.service';

function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Espresso Beans 1kg',
    sku: 'COF-001',
    reorderPoint: 20,
    belowReorderPoint: false,
    active: true,
    ...over,
  };
}

function harness() {
  const inventory = { evaluateReorderAlert: jest.fn().mockResolvedValue('unchanged') };
  const prisma = { product: { findMany: jest.fn().mockResolvedValue([]) } };
  const worker = new InventoryReorderWorker(
    inventory as unknown as InventoryService,
    prisma as unknown as PrismaService,
  );
  return { worker, inventory, prisma };
}

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'inventory.reorder.sweep', data: {}, ...over }) as unknown as Job;

describe('InventoryReorderWorker', () => {
  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    await expect(worker.process(job({ name: 'invoice.overdue.sweep' }))).resolves.toMatchObject({
      skipped: 'name mismatch',
    });
  });

  it('skips when the database is not configured', async () => {
    const worker = new InventoryReorderWorker({} as unknown as InventoryService, undefined);
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('returns cleanly when nothing qualifies', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toEqual({
      ran: true,
      candidates: 0,
      alerted: 0,
      restocked: 0,
      failed: 0,
    });
  });

  it('tallies alerted/restocked outcomes and shares one recipients cache across the batch', async () => {
    const { worker, inventory, prisma } = harness();
    prisma.product.findMany.mockResolvedValue([candidate({ id: 'p1' }), candidate({ id: 'p2' })]);
    inventory.evaluateReorderAlert
      .mockResolvedValueOnce('alerted')
      .mockResolvedValueOnce('restocked');

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 2, alerted: 1, restocked: 1, failed: 0 });
    const [, , cache1] = inventory.evaluateReorderAlert.mock.calls[0];
    const [, , cache2] = inventory.evaluateReorderAlert.mock.calls[1];
    expect(cache1).toBeInstanceOf(Map);
    expect(cache1).toBe(cache2);
  });

  it('logs and continues when one product fails', async () => {
    const { worker, inventory, prisma } = harness();
    prisma.product.findMany.mockResolvedValue([candidate({ id: 'p1' }), candidate({ id: 'p2' })]);
    inventory.evaluateReorderAlert
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce('alerted');

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 2, alerted: 1, failed: 1 });
  });
});
