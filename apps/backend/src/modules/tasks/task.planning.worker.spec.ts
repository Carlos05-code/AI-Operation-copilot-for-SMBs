/**
 * Unit tests — TaskPlanningWorker (signals, LLM plan, dedupe, persist).
 */
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { TaskPlanningWorker } from './task.planning.worker';

function harness(
  overrides: {
    prisma?: {
      invoice?: { findMany: jest.Mock };
      product?: { findMany: jest.Mock };
      inventoryMovement?: { groupBy: jest.Mock };
      task?: { findFirst: jest.Mock; create: jest.Mock };
    };
    llm?: { isConfigured: boolean; complete: jest.Mock };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: TaskPlanningWorker;
  prisma: {
    invoice: { findMany: jest.Mock };
    product: { findMany: jest.Mock };
    inventoryMovement: { groupBy: jest.Mock };
    task: { findFirst: jest.Mock; create: jest.Mock };
  };
  llm: { isConfigured: boolean; complete: jest.Mock };
  outbox: { append: jest.Mock };
} {
  const prisma = {
    invoice: overrides.prisma?.invoice ?? { findMany: jest.fn() },
    product: overrides.prisma?.product ?? { findMany: jest.fn() },
    inventoryMovement: overrides.prisma?.inventoryMovement ?? { groupBy: jest.fn() },
    task: overrides.prisma?.task ?? { findFirst: jest.fn(), create: jest.fn() },
  };
  const llm = overrides.llm ?? { isConfigured: true, complete: jest.fn() };
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const worker = new TaskPlanningWorker(
    { isConfigured: llm.isConfigured, complete: llm.complete } as unknown as LlmProvider,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, llm, outbox };
}

const job = (
  overrides: Partial<Job<{ organizationId: string }>> = {},
): Job<{ organizationId: string }> =>
  ({ name: 'task.plan', data: { organizationId: 'org-1' }, ...overrides }) as unknown as Job<{
    organizationId: string;
  }>;

function defaultSignals(prisma: {
  invoice: { findMany: jest.Mock };
  product: { findMany: jest.Mock };
  inventoryMovement: { groupBy: jest.Mock };
}): void {
  prisma.invoice.findMany.mockResolvedValue([
    {
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      total: { toFixed: () => '500.00' },
      dueDate: new Date('2026-08-01T00:00:00Z'),
      customer: { name: 'Jane Doe' },
    },
  ]);
  prisma.product.findMany.mockResolvedValue([
    { id: 'prod-1', name: 'Espresso Beans 1kg', sku: 'COF-001', reorderPoint: 20 },
  ]);
  prisma.inventoryMovement.groupBy.mockResolvedValue([
    { productId: 'prod-1', type: 'IN', _sum: { quantity: 10 } },
  ]);
}

describe('TaskPlanningWorker', () => {
  it('creates validated tasks from LLM output, deduped by signal key', async () => {
    const { worker, prisma, llm, outbox } = harness();
    defaultSignals(prisma);
    prisma.task.findFirst.mockResolvedValue(null);
    prisma.task.create.mockResolvedValue({ id: 'task-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({
        tasks: [
          {
            title: 'Follow up invoice INV-001',
            priority: 'HIGH',
            dueDate: '2026-08-22',
            reason: 'invoice inv-1',
          },
          { title: 'Reorder espresso beans', priority: 'MEDIUM', reason: 'product prod-1' },
        ],
      }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ planned: true, created: 2, duplicates: 0 });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Follow up invoice INV-001',
          priority: 'HIGH',
          dueDate: new Date('2026-08-22'),
          agentMetadata: expect.objectContaining({
            promptVersion: 'plan.tasks.v1',
            signalKey: 'inv-1',
          }),
        }),
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'task.planned',
        payload: expect.objectContaining({ created: 2, signalCount: 2 }),
      }),
    );
  });

  it('skips tasks whose signal key already has an open task', async () => {
    const { worker, prisma, llm } = harness();
    defaultSignals(prisma);
    prisma.task.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.task.create.mockResolvedValue({ id: 'task-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({
        tasks: [{ title: 'Follow up invoice INV-001', priority: 'HIGH', reason: 'invoice inv-1' }],
      }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ created: 0, duplicates: 1 });
    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          agentMetadata: { path: ['signalKey'], equals: 'inv-1' },
        }),
      }),
    );
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('skips when there are no signals, no database, or no LLM', async () => {
    const { worker, prisma } = harness();
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.inventoryMovement.groupBy.mockResolvedValue([]);
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'no signals' });

    const noDb = new TaskPlanningWorker(
      { isConfigured: false } as unknown as LlmProvider,
      undefined,
      undefined,
    );
    await expect(noDb.process(job())).resolves.toMatchObject({ skipped: 'not configured' });

    const { worker: worker2, prisma: prisma2 } = harness({
      llm: { isConfigured: false, complete: jest.fn() },
    });
    defaultSignals(prisma2);
    await expect(worker2.process(job())).resolves.toMatchObject({ skipped: 'llm not configured' });
  });

  it('flags low-stock products using the IN minus OUT convention', async () => {
    const { worker, prisma, llm } = harness();
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', name: 'Mugs', sku: 'MUG-003', reorderPoint: 40 },
      { id: 'prod-2', name: 'Scales', sku: 'EQU-002', reorderPoint: 5 },
    ]);
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 50 } },
      { productId: 'prod-1', type: 'OUT', _sum: { quantity: 20 } },
      { productId: 'prod-2', type: 'IN', _sum: { quantity: 6 } },
    ]);
    llm.complete.mockResolvedValue('{"tasks":[]}');

    const result = await worker.process(job());

    expect(result).toMatchObject({ planned: true, created: 0 });
    expect(llm.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('[low_stock] Mugs (MUG-003) has 30 on hand, below reorder point 40'),
      expect.any(Number),
    );
    expect(llm.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('[low_stock] Scales'),
      expect.any(Number),
    );
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'conversation.embed' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('throws on malformed model output so BullMQ retries', async () => {
    const { worker, prisma, llm } = harness();
    defaultSignals(prisma);
    llm.complete.mockResolvedValue('{"tasks":"not an array"}');
    await expect(worker.process(job())).rejects.toThrow('malformed JSON');
  });

  it('rejects invalid priorities and dates in the plan payload', async () => {
    const { worker, prisma, llm } = harness();
    defaultSignals(prisma);
    llm.complete.mockResolvedValue(
      JSON.stringify({ tasks: [{ title: 'x', priority: 'EXTREME', dueDate: 'not-a-date' }] }),
    );
    await expect(worker.process(job())).rejects.toThrow('malformed JSON');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('swallows outbox failures after persisting', async () => {
    const { worker, prisma, llm, outbox } = harness();
    defaultSignals(prisma);
    prisma.task.findFirst.mockResolvedValue(null);
    prisma.task.create.mockResolvedValue({ id: 'task-1' });
    llm.complete.mockResolvedValue('{"tasks":[]}');
    outbox.append.mockRejectedValue(new Error('db down'));
    await expect(worker.process(job())).resolves.toMatchObject({ planned: true });
  });
});
