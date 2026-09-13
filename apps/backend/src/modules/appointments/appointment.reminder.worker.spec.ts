/**
 * Unit tests — AppointmentReminderWorker (reminder sweep).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { AppointmentReminderWorker } from './appointment.reminder.worker';

function appointmentRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    organizationId: 'org-1',
    assigneeId: null,
    title: 'Haircut',
    startAt: new Date('2026-04-01T10:00:00Z'),
    status: 'SCHEDULED',
    ...over,
  };
}

function harness() {
  const prisma = {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    member: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new AppointmentReminderWorker(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, outbox };
}

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'appointment.reminder.sweep', data: {}, ...over }) as unknown as Job;

describe('AppointmentReminderWorker', () => {
  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    await expect(worker.process(job({ name: 'invoice.overdue.sweep' }))).resolves.toMatchObject({
      skipped: 'name mismatch',
    });
  });

  it('skips when the database is not configured', async () => {
    const worker = new AppointmentReminderWorker(undefined, undefined);
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('returns cleanly when nothing is due for a reminder', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toEqual({
      ran: true,
      candidates: 0,
      reminded: 0,
      failed: 0,
    });
  });

  it('notifies every OWNER/ADMIN/MANAGER when no staff is assigned', async () => {
    const { worker, prisma, outbox } = harness();
    prisma.appointment.findMany.mockResolvedValue([appointmentRow()]);

    const result = await worker.process(job());

    expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt-1', reminderSentAt: null },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'u1', organizationId: 'org-1' }),
          expect.objectContaining({ userId: 'u2' }),
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.reminder_sent' }),
    );
    expect(result).toMatchObject({ candidates: 1, reminded: 1, failed: 0 });
  });

  it('notifies only the assigned staff member when one is set', async () => {
    const { worker, prisma } = harness();
    prisma.appointment.findMany.mockResolvedValue([appointmentRow({ assigneeId: 'staff-1' })]);

    await worker.process(job());

    expect(prisma.member.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ userId: 'staff-1' })] }),
    );
  });

  it('does not re-remind when a concurrent sweep already claimed it', async () => {
    const { worker, prisma } = harness();
    prisma.appointment.findMany.mockResolvedValue([appointmentRow()]);
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

    const result = await worker.process(job());

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reminded: 0 });
  });

  it('resolves org recipients once per batch, not once per appointment', async () => {
    const { worker, prisma } = harness();
    prisma.appointment.findMany.mockResolvedValue([
      appointmentRow({ id: 'a1' }),
      appointmentRow({ id: 'a2' }),
    ]);
    await worker.process(job());
    expect(prisma.member.findMany).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when one appointment fails', async () => {
    const { worker, prisma } = harness();
    prisma.appointment.findMany.mockResolvedValue([
      appointmentRow({ id: 'a1' }),
      appointmentRow({ id: 'a2' }),
    ]);
    prisma.appointment.updateMany
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce({ count: 1 });

    const result = await worker.process(job());

    expect(result).toMatchObject({ candidates: 2, reminded: 1, failed: 1 });
  });
});
