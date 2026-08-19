/**
 * Unit tests — DashboardService (executive KPI aggregation).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { PrismaService } from '../database/prisma.service';
import { DashboardService } from './dashboard.service';

function harness(): {
  service: DashboardService;
  prisma: {
    invoice: { aggregate: jest.Mock };
    task: { count: jest.Mock; groupBy: jest.Mock };
    notification: { count: jest.Mock; findMany: jest.Mock };
  };
} {
  const prisma = {
    invoice: { aggregate: jest.fn() },
    task: { count: jest.fn(), groupBy: jest.fn() },
    notification: { count: jest.fn(), findMany: jest.fn() },
  };
  const service = new DashboardService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('DashboardService', () => {
  it('aggregates revenue, receivables, tasks, and alerts for the org', async () => {
    const { service, prisma } = harness();
    prisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { total: { toFixed: () => '10000.00' } },
      _count: { id: 3 },
    });
    prisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { total: { toFixed: () => '2000.00' } },
    });
    prisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { total: { toFixed: () => '1500.00' } },
    });
    prisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { total: { toFixed: () => '5000.00' } },
      _count: { id: 2 },
    });
    prisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { total: { toFixed: () => '1200.00' } },
    });
    prisma.task.count.mockResolvedValueOnce(6);
    prisma.task.count.mockResolvedValueOnce(2);
    prisma.task.count.mockResolvedValueOnce(1);
    prisma.task.groupBy.mockResolvedValue([
      { priority: 'HIGH', _count: { _all: 3 } },
      { priority: 'LOW', _count: { _all: 3 } },
    ]);
    prisma.notification.count.mockResolvedValue(4);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        kind: 'IN_APP',
        title: 'Overdue invoice',
        body: null,
        createdAt: new Date('2026-08-19T09:00:00Z'),
      },
    ]);

    const result = await service.summary('org-1');

    expect(result.revenue).toEqual({
      total: '10000.00',
      thisMonth: '2000.00',
      lastMonth: '1500.00',
      paidInvoices: 3,
    });
    expect(result.receivables).toEqual({
      outstanding: '5000.00',
      overdue: '1200.00',
      openInvoices: 2,
    });
    expect(result.tasks).toEqual({
      open: 6,
      overdue: 2,
      dueToday: 1,
      byPriority: { HIGH: 3, LOW: 3 },
    });
    expect(result.alerts.unread).toBe(4);
    expect(result.alerts.recent[0]).toMatchObject({ id: 'n1', title: 'Overdue invoice' });

    for (const call of prisma.invoice.aggregate.mock.calls) {
      expect(call[0].where.organizationId).toBe('org-1');
    }
  });

  it('renders empty orgs as zeros with an empty priority map', async () => {
    const { service, prisma } = harness();
    prisma.invoice.aggregate.mockResolvedValue({ _sum: { total: null }, _count: { id: 0 } });
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.findMany.mockResolvedValue([]);

    const result = await service.summary('org-1');

    expect(result.revenue.total).toBe('0.00');
    expect(result.tasks.byPriority).toEqual({});
    expect(result.alerts.recent).toEqual([]);
  });

  it('fails with a contract error when the database is not configured', async () => {
    const service = new DashboardService(undefined);
    await expect(service.summary('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
