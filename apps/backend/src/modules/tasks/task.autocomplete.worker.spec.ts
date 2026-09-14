/**
 * Unit tests — TaskAutoCompletionWorker (signal resolution, guarded claim,
 * notify, fail-soft).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { TaskAutoCompletionWorker } from './task.autocomplete.worker';

function harness() {
  const prisma = {
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    member: { findMany: jest.fn().mockResolvedValue([{ userId: 'owner-1' }]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new TaskAutoCompletionWorker(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, outbox };
}

const job = (overrides: Partial<Job> = {}): Job =>
  ({ name: 'task.autocomplete.sweep', ...overrides }) as unknown as Job;

function taskRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    title: 'Follow up invoice INV-001',
    assigneeId: null,
    agentMetadata: { promptVersion: 'plan.tasks.v1', signalKey: 'inv-1' },
    ...over,
  };
}

describe('TaskAutoCompletionWorker', () => {
  it('completes a task whose linked invoice is now PAID, notifying org alert roles', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'PAID' },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ ran: true, candidates: 1, completed: 1, notified: 1 });
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', status: { in: ['TODO', 'IN_PROGRESS'] } },
      data: { status: 'DONE' },
    });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          agentMetadata: expect.objectContaining({
            signalKey: 'inv-1',
            autoCompletedReason: 'Invoice INV-001 is now PAID',
          }),
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            organizationId: 'org-1',
            userId: 'owner-1',
            title: 'Task auto-completed: Follow up invoice INV-001',
            body: 'Invoice INV-001 is now PAID',
          }),
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'task.autocompleted',
        payload: expect.objectContaining({ taskId: 'task-1' }),
      }),
    );
  });

  it('notifies only the assignee when one is set', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow({ assigneeId: 'staff-1' })]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'VOID' },
    ]);

    await worker.process(job());

    expect(prisma.member.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: 'staff-1' })],
      }),
    );
  });

  it('completes a low-stock task whose product climbed back above the reorder point', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([
      taskRow({
        id: 'task-2',
        title: 'Reorder espresso beans',
        agentMetadata: { signalKey: 'prod-1' },
      }),
    ]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', name: 'Espresso Beans 1kg', sku: 'COF-001', belowReorderPoint: false },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ completed: 1 });
    const data = prisma.task.update.mock.calls[0][0].data;
    expect(data.agentMetadata.autoCompletedReason).toBe(
      'Espresso Beans 1kg (COF-001) is restocked above its reorder point',
    );
  });

  it('leaves a task alone when its signal has not resolved yet', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'OVERDUE' },
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 1, completed: 0 });
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('ignores tasks with no signalKey and tasks whose signal matches nothing', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([
      taskRow({ id: 'task-3', agentMetadata: null }),
      taskRow({ id: 'task-4', agentMetadata: { signalKey: 'ghost-id' } }),
    ]);

    const result = await worker.process(job());

    expect(result).toMatchObject({ ran: true, candidates: 1, completed: 0 });
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('does not double-complete when a concurrent run already claimed the task', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'PAID' },
    ]);
    prisma.task.updateMany.mockResolvedValue({ count: 0 });

    const result = await worker.process(job());

    expect(result).toMatchObject({ completed: 0, notified: 0 });
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('skips when there are no open tasks or no database', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toMatchObject({ ran: true, candidates: 0 });

    const noDb = new TaskAutoCompletionWorker(undefined, undefined);
    await expect(noDb.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'invoice.overdue.sweep' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('continues past a per-task failure', async () => {
    const { worker, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow(), taskRow({ id: 'task-2' })]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'PAID' },
    ]);
    prisma.member.findMany.mockRejectedValueOnce(new Error('db blip'));

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 2, completed: 1 });
  });

  it('swallows outbox failures after completing', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.task.findMany.mockResolvedValue([taskRow()]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-001', status: 'PAID' },
    ]);
    outbox.append.mockRejectedValue(new Error('db down'));

    await expect(worker.process(job())).resolves.toMatchObject({ completed: 1 });
  });
});
