/**
 * Unit tests — InvoiceService (generation, numbering, lifecycle, recurrence).
 */
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { InvoiceService, ScheduleRaceError } from './invoice.service';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function invoiceRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    recurringInvoiceId: null,
    invoiceNumber: 'INV-2026-0001',
    status: 'DRAFT',
    note: null,
    dueDate: new Date('2026-04-01T00:00:00Z'),
    subtotal: decimal('55.50'),
    taxTotal: decimal('0.00'),
    total: decimal('55.50'),
    issuedAt: null,
    paidAt: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    items: [
      {
        id: 'it-1',
        productId: null,
        description: 'Beans',
        quantity: 3,
        unitPrice: decimal('18.50'),
        taxRate: decimal('0.00'),
        lineTotal: decimal('55.50'),
      },
    ],
    ...over,
  };
}

function harness() {
  const prisma = {
    invoice: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue(invoiceRow()),
      update: jest.fn(),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
    product: { count: jest.fn().mockResolvedValue(0) },
    recurringInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new InvoiceService(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { service, prisma, outbox };
}

const items = [{ description: 'Beans', quantity: 3, unitPrice: 18.5 }];

describe('InvoiceService.create', () => {
  it('prices items, allocates INV-<year>-0001, persists, and emits invoice.created', async () => {
    const { service, prisma, outbox } = harness();
    prisma.invoice.findFirst.mockResolvedValue(invoiceRow());

    const view = await service.create({
      organizationId: 'org-1',
      customerId: 'cust-1',
      items,
      dueDate: new Date('2026-04-01T00:00:00Z'),
    });

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          invoiceNumber: 'INV-2026-0001',
          status: 'DRAFT',
          subtotal: '55.50',
          total: '55.50',
          items: {
            create: [expect.objectContaining({ description: 'Beans', lineTotal: '55.50' })],
          },
        }),
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.created', aggregateType: 'invoice' }),
    );
    expect(view.total).toBe('55.50');
    expect(view.items?.[0].lineTotal).toBe('55.50');
  });

  it('creates the invoice already SENT with issuedAt when issue=true', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst.mockResolvedValue(invoiceRow({ status: 'SENT' }));

    await service.create({
      organizationId: 'org-1',
      customerId: 'cust-1',
      items,
      dueDate: new Date('2026-04-01T00:00:00Z'),
      issue: true,
    });

    const data = prisma.invoice.create.mock.calls[0][0].data;
    expect(data.status).toBe('SENT');
    expect(data.issuedAt).toBeInstanceOf(Date);
  });

  it('404s when the customer is not in the org', async () => {
    const { service, prisma } = harness();
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        organizationId: 'org-1',
        customerId: 'ghost',
        items,
        dueDate: new Date(),
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND, status: 404 });
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('404s when a line-item product is not in the org', async () => {
    const { service, prisma } = harness();
    prisma.product.count.mockResolvedValue(0);
    await expect(
      service.create({
        organizationId: 'org-1',
        customerId: 'cust-1',
        items: [{ productId: 'p1', description: 'A', quantity: 1, unitPrice: 5 }],
        dueDate: new Date(),
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND, status: 404 });
  });

  it('numbers the invoice from the atomic per-org, per-year counter', async () => {
    const { service, prisma } = harness();
    const year = new Date().getUTCFullYear();
    prisma.invoice.findFirst.mockResolvedValue(invoiceRow({ invoiceNumber: `INV-${year}-0043` }));
    prisma.$queryRaw.mockResolvedValue([{ value: 43 }]);

    await service.create({
      organizationId: 'org-1',
      customerId: 'cust-1',
      items,
      dueDate: new Date('2026-04-01T00:00:00Z'),
    });

    // Confirms the service passes the right params (the tagged-template's own SQL text isn't
    // asserted here — no live Postgres in this unit test to actually exercise it against).
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'org-1', year);
    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceNumber: `INV-${year}-0043` }),
      }),
    );
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new InvoiceService(undefined, undefined);
    await expect(
      service.create({ organizationId: 'o', customerId: 'c', items, dueDate: new Date() }),
    ).rejects.toMatchObject({ code: HttpErrorCode.INTERNAL_ERROR, status: 503 });
  });
});

describe('InvoiceService lifecycle', () => {
  it('issues a draft (DRAFT → SENT)', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst
      .mockResolvedValueOnce({ id: 'inv-1', status: 'DRAFT' })
      .mockResolvedValueOnce(invoiceRow({ status: 'SENT' }));
    prisma.invoice.update.mockResolvedValue(invoiceRow({ status: 'SENT' }));

    const view = await service.issue('org-1', 'inv-1');

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(view.status).toBe('SENT');
  });

  it('rejects an illegal transition with 409', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'PAID' });
    await expect(service.issue('org-1', 'inv-1')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      status: 409,
    });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('404s an unknown invoice', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(service.markPaid('org-1', 'nope')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('is idempotent when already in the target status', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst
      .mockResolvedValueOnce({ id: 'inv-1', status: 'SENT' })
      .mockResolvedValueOnce(invoiceRow({ status: 'SENT' }));
    const view = await service.issue('org-1', 'inv-1');
    expect(view.status).toBe('SENT');
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('marks SENT and OVERDUE invoices paid but not a draft', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst
      .mockResolvedValueOnce({ id: 'inv-1', status: 'OVERDUE' })
      .mockResolvedValueOnce(invoiceRow({ status: 'PAID' }));
    prisma.invoice.update.mockResolvedValue(invoiceRow({ status: 'PAID' }));
    await expect(service.markPaid('org-1', 'inv-1')).resolves.toMatchObject({ status: 'PAID' });

    prisma.invoice.findFirst.mockReset();
    prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-2', status: 'DRAFT' });
    await expect(service.markPaid('org-1', 'inv-2')).rejects.toMatchObject({ status: 409 });
  });
});

describe('InvoiceService.generateForRecurring', () => {
  const schedule = {
    id: 'sch-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    cadence: 'MONTHLY' as const,
    interval: 1,
    netTermsDays: 30,
    issueOnCreate: true,
    active: true,
    note: 'Monthly retainer',
    lineItems: [{ description: 'Retainer', quantity: 1, unitPrice: 500 }],
    nextRunAt: new Date('2026-03-01T00:00:00Z'),
    lastRunAt: null,
    generatedCount: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  };

  it('creates a SENT invoice linked to the schedule and advances nextRunAt in the tx', async () => {
    const { service, prisma } = harness();
    prisma.invoice.findFirst.mockResolvedValue(
      invoiceRow({ status: 'SENT', recurringInvoiceId: 'sch-1' }),
    );
    const now = new Date('2026-03-02T09:00:00Z');

    const view = await service.generateForRecurring(schedule, now);

    const data = prisma.invoice.create.mock.calls[0][0].data;
    expect(data.recurringInvoiceId).toBe('sch-1');
    expect(data.status).toBe('SENT');
    expect(prisma.recurringInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sch-1', nextRunAt: schedule.nextRunAt, active: true },
        data: expect.objectContaining({
          nextRunAt: new Date('2026-04-01T00:00:00Z'),
          generatedCount: { increment: 1 },
        }),
      }),
    );
    expect(view.status).toBe('SENT');
  });

  it('throws ScheduleRaceError when the schedule was already advanced', async () => {
    const { service, prisma } = harness();
    prisma.recurringInvoice.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.generateForRecurring(schedule, new Date('2026-03-02T09:00:00Z')),
    ).rejects.toBeInstanceOf(ScheduleRaceError);
  });
});
