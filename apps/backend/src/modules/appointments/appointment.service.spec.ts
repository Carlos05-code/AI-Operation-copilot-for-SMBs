/**
 * Unit tests — AppointmentService (booking, conflicts, lifecycle).
 */
import { AppointmentStatus } from '@prisma/client';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { AppointmentService } from './appointment.service';

function appointmentRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    organizationId: 'org-1',
    customerId: null,
    assigneeId: null,
    title: 'Haircut',
    notes: null,
    startAt: new Date('2026-04-01T10:00:00Z'),
    endAt: new Date('2026-04-01T11:00:00Z'),
    status: 'SCHEDULED',
    reminderSentAt: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    appointment: {
      create: jest.fn().mockResolvedValue(appointmentRow()),
      findMany: jest.fn().mockResolvedValue([appointmentRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(appointmentRow()),
      update: jest.fn().mockResolvedValue(appointmentRow()),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new AppointmentService(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { service, prisma, outbox };
}

const window = {
  startAt: new Date('2026-04-01T10:00:00Z'),
  endAt: new Date('2026-04-01T11:00:00Z'),
};

describe('AppointmentService.create', () => {
  it('books an unassigned appointment without checking for conflicts', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(null); // no conflict lookup should even run

    const view = await service.create({ organizationId: 'org-1', title: 'Haircut', ...window });

    expect(prisma.appointment.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        customerId: null,
        assigneeId: null,
        title: 'Haircut',
        notes: null,
        startAt: window.startAt,
        endAt: window.endAt,
      },
    });
    expect(view.title).toBe('Haircut');
  });

  it('409s when the assignee already holds an overlapping slot', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(
      appointmentRow({ id: 'appt-existing', startAt: window.startAt, endAt: window.endAt }),
    );

    await expect(
      service.create({
        organizationId: 'org-1',
        assigneeId: 'staff-1',
        title: 'Haircut',
        ...window,
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.CONFLICT, status: 409 });
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('creates when the assignee has no overlapping holding appointment', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(null);

    await service.create({
      organizationId: 'org-1',
      assigneeId: 'staff-1',
      title: 'Haircut',
      ...window,
    });

    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: 'staff-1',
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
        }),
      }),
    );
    expect(prisma.appointment.create).toHaveBeenCalled();
  });

  it('404s an unknown customer', async () => {
    const { service, prisma } = harness();
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ organizationId: 'org-1', customerId: 'ghost', title: 'x', ...window }),
    ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND, status: 404 });
  });

  it('400s an inverted or over-long window and an empty title', async () => {
    const { service } = harness();
    await expect(
      service.create({
        organizationId: 'org-1',
        title: 'x',
        startAt: window.endAt,
        endAt: window.startAt,
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR, status: 400 });
    await expect(
      service.create({
        organizationId: 'org-1',
        title: 'x',
        startAt: window.startAt,
        endAt: new Date(window.startAt.getTime() + 25 * 60 * 60 * 1000),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create({ organizationId: 'org-1', title: '  ', ...window }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new AppointmentService(undefined, undefined);
    await expect(
      service.create({ organizationId: 'org-1', title: 'x', ...window }),
    ).rejects.toMatchObject({ code: HttpErrorCode.INTERNAL_ERROR, status: 503 });
  });
});

describe('AppointmentService.list/get', () => {
  it('passes date-range and filter options through to the query', async () => {
    const { service, prisma } = harness();
    await service.list('org-1', 1, 20, {
      from: window.startAt,
      to: window.endAt,
      assigneeId: 'staff-1',
      status: 'CONFIRMED',
    });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          assigneeId: 'staff-1',
          status: 'CONFIRMED',
          startAt: { gte: window.startAt, lte: window.endAt },
        },
      }),
    );
  });

  it('404s an unknown or foreign appointment', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'appt-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AppointmentService.update', () => {
  it('edits notes without touching the window or checking conflicts', async () => {
    const { service, prisma } = harness();
    await service.update('org-1', 'appt-1', { notes: 'bring own clippers' });
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { notes: 'bring own clippers' },
    });
  });

  it('reschedules a SCHEDULED appointment and emits appointment.rescheduled', async () => {
    const { service, prisma, outbox } = harness();
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow()) // load()
      .mockResolvedValueOnce(null); // conflict check
    const newStart = new Date('2026-04-02T10:00:00Z');
    const newEnd = new Date('2026-04-02T11:00:00Z');

    await service.update('org-1', 'appt-1', { startAt: newStart, endAt: newEnd });

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { startAt: newStart, endAt: newEnd },
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.rescheduled' }),
    );
  });

  it('409s rescheduling a terminal appointment', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(appointmentRow({ status: 'COMPLETED' }));
    await expect(
      service.update('org-1', 'appt-1', { startAt: window.startAt, endAt: window.endAt }),
    ).rejects.toMatchObject({ code: HttpErrorCode.CONFLICT, status: 409 });
  });

  it('is a no-op when the patch is empty', async () => {
    const { service, prisma } = harness();
    await service.update('org-1', 'appt-1', {});
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });
});

describe('AppointmentService.updateStatus', () => {
  it('confirms a scheduled appointment and emits appointment.status_changed', async () => {
    const { service, prisma, outbox } = harness();
    prisma.appointment.update.mockResolvedValue(appointmentRow({ status: 'CONFIRMED' }));

    const view = await service.updateStatus('org-1', 'appt-1', AppointmentStatus.CONFIRMED);

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { status: 'CONFIRMED' },
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'appointment.status_changed' }),
    );
    expect(view.status).toBe('CONFIRMED');
  });

  it('409s an illegal transition and is idempotent on a repeat', async () => {
    const { service, prisma } = harness();
    prisma.appointment.findFirst.mockResolvedValue(appointmentRow({ status: 'CANCELLED' }));
    await expect(
      service.updateStatus('org-1', 'appt-1', AppointmentStatus.CONFIRMED),
    ).rejects.toMatchObject({
      status: 409,
    });

    prisma.appointment.findFirst.mockResolvedValue(appointmentRow({ status: 'SCHEDULED' }));
    const view = await service.updateStatus('org-1', 'appt-1', AppointmentStatus.SCHEDULED);
    expect(view.status).toBe('SCHEDULED');
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });
});
