/**
 * Unit tests — RecurringInvoiceService (schedule CRUD + due query).
 */
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { RecurringInvoiceService } from './recurring-invoice.service';

function scheduleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sch-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    cadence: 'MONTHLY',
    interval: 1,
    netTermsDays: 30,
    issueOnCreate: true,
    active: true,
    note: null,
    lineItems: [
      { productId: null, description: 'Retainer', quantity: 1, unitPrice: 500, taxRate: 0 },
    ],
    nextRunAt: new Date('2026-03-01T00:00:00Z'),
    lastRunAt: null,
    generatedCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
    recurringInvoice: {
      create: jest.fn().mockResolvedValue(scheduleRow()),
      findMany: jest.fn().mockResolvedValue([scheduleRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(scheduleRow()),
      update: jest.fn().mockResolvedValue(scheduleRow()),
      delete: jest.fn().mockResolvedValue(scheduleRow()),
    },
  };
  const service = new RecurringInvoiceService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const baseInput = {
  organizationId: 'org-1',
  customerId: 'cust-1',
  items: [{ description: 'Retainer', quantity: 1, unitPrice: 500 }],
  cadence: 'MONTHLY' as const,
};

describe('RecurringInvoiceService.create', () => {
  it('stores a normalized template and a preview of the totals', async () => {
    const { service, prisma } = harness();
    const view = await service.create({ ...baseInput, interval: 2, netTermsDays: 14 });

    expect(prisma.recurringInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          cadence: 'MONTHLY',
          interval: 2,
          netTermsDays: 14,
          lineItems: [
            { productId: null, description: 'Retainer', quantity: 1, unitPrice: 500, taxRate: 0 },
          ],
        }),
      }),
    );
    expect(view.preview).toEqual({ subtotal: '500.00', taxTotal: '0.00', total: '500.00' });
  });

  it('defaults nextRunAt to startsAt when supplied', async () => {
    const { service, prisma } = harness();
    await service.create({ ...baseInput, startsAt: new Date('2026-06-01T00:00:00Z') });
    expect(prisma.recurringInvoice.create.mock.calls[0][0].data.nextRunAt).toEqual(
      new Date('2026-06-01T00:00:00Z'),
    );
  });

  it('404s an unknown customer and 400s a bad interval or template', async () => {
    const { service, prisma } = harness();
    await expect(service.create({ ...baseInput, interval: 999 })).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
    });
    await expect(
      service.create({ ...baseInput, items: [{ description: '', quantity: 1, unitPrice: 1 }] }),
    ).rejects.toMatchObject({ status: 400 });

    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.create(baseInput)).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });
});

describe('RecurringInvoiceService mutations', () => {
  it('404s get/pause/delete for a foreign schedule', async () => {
    const { service, prisma } = harness();
    prisma.recurringInvoice.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'sch-1')).rejects.toMatchObject({ status: 404 });
    await expect(service.setActive('org-2', 'sch-1', false)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('org-2', 'sch-1')).rejects.toMatchObject({ status: 404 });
  });

  it('resuming a past-due schedule pulls nextRunAt forward to now', async () => {
    const { service, prisma } = harness();
    prisma.recurringInvoice.findFirst.mockResolvedValue(
      scheduleRow({ active: false, nextRunAt: new Date('2020-01-01T00:00:00Z') }),
    );
    const before = Date.now();
    await service.setActive('org-1', 'sch-1', true);
    const passed = prisma.recurringInvoice.update.mock.calls[0][0].data.nextRunAt as Date;
    expect(passed.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('keeps a future nextRunAt untouched when resuming', async () => {
    const { service, prisma } = harness();
    const future = new Date(Date.now() + 86_400_000);
    prisma.recurringInvoice.findFirst.mockResolvedValue(
      scheduleRow({ active: false, nextRunAt: future }),
    );
    await service.setActive('org-1', 'sch-1', true);
    expect(prisma.recurringInvoice.update.mock.calls[0][0].data.nextRunAt).toEqual(future);
  });

  it('listDue queries active schedules at or before now, oldest first', async () => {
    const { service, prisma } = harness();
    const now = new Date('2026-03-05T00:00:00Z');
    await service.listDue(now, 10);
    expect(prisma.recurringInvoice.findMany).toHaveBeenCalledWith({
      where: { active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 10,
    });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new RecurringInvoiceService(undefined);
    await expect(service.list('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
