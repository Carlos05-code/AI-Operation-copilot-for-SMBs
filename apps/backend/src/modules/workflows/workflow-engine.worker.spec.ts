/**
 * Unit tests — WorkflowEngineWorker (condition matching, fire-once guard,
 * actions, per-entity fail-soft).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { WorkflowEngineWorker } from './workflow-engine.worker';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function ruleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rule-1',
    organizationId: 'org-1',
    name: 'Notify on overdue',
    triggerEntity: 'INVOICE',
    conditions: [{ field: 'status', operator: 'eq', value: 'OVERDUE' }],
    actions: [{ type: 'SEND_NOTIFICATION', title: 'Invoice overdue', body: 'Invoice overdue' }],
    active: true,
    ...over,
  };
}

function harness() {
  const prisma = {
    workflowRule: { findMany: jest.fn().mockResolvedValue([]) },
    workflowRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      update: jest.fn().mockResolvedValue({ id: 'run-1' }),
    },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 't-1' }),
    },
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
    member: { findMany: jest.fn().mockResolvedValue([{ userId: 'owner-1' }]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new WorkflowEngineWorker(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, outbox };
}

const job = (overrides: Partial<Job> = {}): Job =>
  ({ name: 'workflow.rules.sweep', ...overrides }) as unknown as Job;

describe('WorkflowEngineWorker', () => {
  it('fires a SEND_NOTIFICATION action when an invoice matches, notifying org alert roles', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([ruleRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', status: 'OVERDUE', total: decimal('100.00') },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ ran: true, rules: 1, evaluated: 1, fired: 1 });
    expect(prisma.workflowRun.create).toHaveBeenCalledWith({
      data: { ruleId: 'rule-1', entityId: 'inv-1', actionsRun: [] },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            organizationId: 'org-1',
            userId: 'owner-1',
            title: 'Invoice overdue',
            payload: { workflowRuleId: 'rule-1', entityId: 'inv-1' },
          }),
        ],
      }),
    );
    expect(prisma.workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ruleId_entityId: { ruleId: 'rule-1', entityId: 'inv-1' } },
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'workflow.rule_fired',
        payload: expect.objectContaining({ ruleId: 'rule-1', entityId: 'inv-1' }),
      }),
    );
  });

  it('fires a CREATE_TASK action when a product matches', async () => {
    const { worker, prisma } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([
      ruleRow({
        triggerEntity: 'PRODUCT',
        conditions: [{ field: 'belowReorderPoint', operator: 'eq', value: true }],
        actions: [{ type: 'CREATE_TASK', title: 'Reorder stock', priority: 'HIGH' }],
      }),
    ]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', belowReorderPoint: true, reorderPoint: 20 },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ fired: 1 });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          title: 'Reorder stock',
          priority: 'HIGH',
          agentMetadata: { workflowRuleId: 'rule-1', entityId: 'prod-1' },
        }),
      }),
    );
  });

  it('does not fire when conditions do not match', async () => {
    const { worker, prisma } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([ruleRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', status: 'SENT', total: decimal('1.00') },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ evaluated: 1, fired: 0 });
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });

  it('never re-fires on an entity the rule has already matched', async () => {
    const { worker, prisma } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([ruleRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', status: 'OVERDUE', total: decimal('100.00') },
    ]);
    prisma.workflowRun.findFirst.mockResolvedValue({ id: 'run-existing' });

    const result = await worker.process(job());

    expect(result).toMatchObject({ fired: 0 });
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });

  it('continues past a per-rule failure', async () => {
    const { worker, prisma } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([
      ruleRow({ id: 'rule-1' }),
      ruleRow({ id: 'rule-2' }),
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', status: 'OVERDUE', total: decimal('100.00') },
    ]);
    prisma.workflowRun.findFirst
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce(null);

    const result = await worker.process(job());

    expect(result).toMatchObject({ evaluated: 2, fired: 1 });
  });

  it('skips when there are no active rules or no database', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toMatchObject({ ran: true, rules: 0 });

    const noDb = new WorkflowEngineWorker(undefined, undefined);
    await expect(noDb.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'invoice.overdue.sweep' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('swallows outbox failures after firing', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.workflowRule.findMany.mockResolvedValue([ruleRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', status: 'OVERDUE', total: decimal('100.00') },
    ]);
    outbox.append.mockRejectedValue(new Error('db down'));

    await expect(worker.process(job())).resolves.toMatchObject({ fired: 1 });
  });
});
