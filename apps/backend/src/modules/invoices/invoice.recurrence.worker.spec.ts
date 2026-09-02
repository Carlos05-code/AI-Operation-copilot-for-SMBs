/**
 * Unit tests — InvoiceRecurrenceWorker (due schedules → generated invoices).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { InvoiceRecurrenceWorker } from './invoice.recurrence.worker';
import { InvoiceService, ScheduleRaceError } from './invoice.service';
import type { RecurringInvoiceService } from './recurring-invoice.service';

function harness() {
  const invoices = { generateForRecurring: jest.fn().mockResolvedValue({ id: 'inv-1' }) };
  const schedules = { listDue: jest.fn().mockResolvedValue([]) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const prisma = {};
  const worker = new InvoiceRecurrenceWorker(
    invoices as unknown as InvoiceService,
    schedules as unknown as RecurringInvoiceService,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, invoices, schedules, outbox };
}

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'invoice.recurrence.run', data: {}, ...over }) as unknown as Job;

const sched = (id: string) => ({ id, organizationId: 'org-1' });

describe('InvoiceRecurrenceWorker', () => {
  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    await expect(worker.process(job({ name: 'invoice.overdue.sweep' }))).resolves.toMatchObject({
      skipped: 'name mismatch',
    });
  });

  it('skips when the database is not configured', async () => {
    const worker = new InvoiceRecurrenceWorker(
      {} as unknown as InvoiceService,
      {} as unknown as RecurringInvoiceService,
      undefined,
      undefined,
    );
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('returns cleanly when nothing is due', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toEqual({
      ran: true,
      due: 0,
      generated: 0,
      raced: 0,
      failed: 0,
    });
  });

  it('generates one invoice per due schedule and emits invoice.recurrence.generated', async () => {
    const { worker, schedules, outbox } = harness();
    schedules.listDue.mockResolvedValue([sched('a'), sched('b')]);
    const result = await worker.process(job());
    expect(result).toMatchObject({ ran: true, due: 2, generated: 2, raced: 0, failed: 0 });
    expect(outbox.append).toHaveBeenCalledTimes(2);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.recurrence.generated' }),
    );
  });

  it('counts a ScheduleRaceError as raced, not failed, and keeps going', async () => {
    const { worker, invoices, schedules } = harness();
    schedules.listDue.mockResolvedValue([sched('a'), sched('b')]);
    invoices.generateForRecurring
      .mockRejectedValueOnce(new ScheduleRaceError('a'))
      .mockResolvedValueOnce({ id: 'inv-b' });
    const result = await worker.process(job());
    expect(result).toMatchObject({ generated: 1, raced: 1, failed: 0 });
  });

  it('counts a generic error as failed and still processes the rest of the batch', async () => {
    const { worker, invoices, schedules } = harness();
    schedules.listDue.mockResolvedValue([sched('a'), sched('b')]);
    invoices.generateForRecurring
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce({ id: 'inv-b' });
    const result = await worker.process(job());
    expect(result).toMatchObject({ generated: 1, raced: 0, failed: 1 });
  });
});
