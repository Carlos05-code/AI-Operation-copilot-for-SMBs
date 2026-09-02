/**
 * Unit tests — InvoiceOverdueWorker (past-due SENT → OVERDUE + alerts).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { InvoiceOverdueWorker } from './invoice.overdue.worker';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    invoiceNumber: 'INV-2026-0001',
    dueDate: new Date('2026-02-01T00:00:00Z'),
    total: decimal('120.00'),
    ...over,
  };
}

function harness() {
  const prisma = {
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    member: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
    },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new InvoiceOverdueWorker(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, outbox };
}

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'invoice.overdue.sweep', data: {}, ...over }) as unknown as Job;

describe('InvoiceOverdueWorker', () => {
  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    await expect(worker.process(job({ name: 'invoice.recurrence.run' }))).resolves.toMatchObject({
      skipped: 'name mismatch',
    });
  });

  it('skips when the database is not configured', async () => {
    const worker = new InvoiceOverdueWorker(undefined, undefined);
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('returns cleanly when nothing is past due', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toEqual({
      ran: true,
      candidates: 0,
      markedOverdue: 0,
      notified: 0,
    });
  });

  it('flips SENT → OVERDUE and notifies every manager of the org', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.invoice.findMany.mockResolvedValue([candidate()]);

    const result = await worker.process(job());

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'SENT' },
      data: { status: 'OVERDUE' },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'u1', kind: 'IN_APP', organizationId: 'org-1' }),
          expect.objectContaining({ userId: 'u2' }),
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.overdue' }),
    );
    expect(result).toMatchObject({ candidates: 1, markedOverdue: 1, notified: 2 });
  });

  it('does not re-notify an invoice already moved off SENT (updateMany count 0)', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.invoice.findMany.mockResolvedValue([candidate()]);
    prisma.invoice.updateMany.mockResolvedValue({ count: 0 });

    const result = await worker.process(job());

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
    expect(result).toMatchObject({ markedOverdue: 0, notified: 0 });
  });

  it('resolves the recipient set once per org across candidates', async () => {
    const { worker, prisma } = harness();
    prisma.invoice.findMany.mockResolvedValue([
      candidate({ id: 'inv-1' }),
      candidate({ id: 'inv-2' }),
    ]);
    await worker.process(job());
    expect(prisma.member.findMany).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when one invoice fails', async () => {
    const { worker, prisma } = harness();
    prisma.invoice.findMany.mockResolvedValue([
      candidate({ id: 'inv-1' }),
      candidate({ id: 'inv-2' }),
    ]);
    prisma.$transaction
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockImplementationOnce((cb: (tx: typeof prisma) => unknown) => cb(prisma));

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 2, markedOverdue: 1 });
  });
});
