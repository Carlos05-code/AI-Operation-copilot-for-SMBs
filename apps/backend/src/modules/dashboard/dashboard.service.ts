/**
 * DashboardService: executive summary KPIs (ROADMAP Phase 3, API_SPEC §11.10).
 *
 * Single org-scoped snapshot endpoint aggregating the four executive lenses:
 *
 * - **revenue** — recognized revenue: `PAID` invoice totals (all-time, this
 *   calendar month, last calendar month);
 * - **receivables** — open AR: `SENT` + `OVERDUE` invoice totals (outstanding
 *   and overdue split);
 * - **tasks** — open task counts (open, overdue, due today) + open-task split
 *   by priority;
 * - **alerts** — unread notification count + the five latest notifications.
 *
 * All queries are filtered by `organizationId` from the verified token
 * (entity-level tenancy). Money is returned as exact decimal strings
 * (`toFixed(2)`) — never floats. Fails with a contract error when the
 * database is not configured.
 */
import { Injectable, Optional } from '@nestjs/common';
import { InvoiceStatus, TaskStatus } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';

export interface DashboardSummary {
  generatedAt: string;
  revenue: {
    total: string;
    thisMonth: string;
    lastMonth: string;
    paidInvoices: number;
  };
  receivables: {
    outstanding: string;
    overdue: string;
    openInvoices: number;
  };
  tasks: {
    open: number;
    overdue: number;
    dueToday: number;
    byPriority: Record<string, number>;
  };
  alerts: {
    unread: number;
    recent: Array<{
      id: string;
      kind: string;
      title: string;
      body: string | null;
      createdAt: string;
    }>;
  };
}

const OPEN_TASK_STATUSES = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];
const OPEN_INVOICE_STATUSES = [InvoiceStatus.SENT, InvoiceStatus.OVERDUE];

@Injectable()
export class DashboardService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async summary(organizationId: string): Promise<DashboardSummary> {
    const prisma = this.requirePrisma();
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(addMonths(now, -1));

    const [
      revenueTotal,
      revenueThisMonth,
      revenueLastMonth,
      receivables,
      overdue,
      taskCounts,
      overdueTasks,
      dueTodayTasks,
      prioritySplit,
      unreadAlerts,
      recentAlerts,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.PAID },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.PAID, createdAt: { gte: thisMonthStart } },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: {
          organizationId,
          status: InvoiceStatus.PAID,
          createdAt: { gte: lastMonthStart, lt: thisMonthStart },
        },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: { in: OPEN_INVOICE_STATUSES } },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.OVERDUE },
        _sum: { total: true },
      }),
      prisma.task.count({ where: { organizationId, status: { in: OPEN_TASK_STATUSES } } }),
      prisma.task.count({
        where: { organizationId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: now } },
      }),
      prisma.task.count({
        where: {
          organizationId,
          status: { in: OPEN_TASK_STATUSES },
          dueDate: { gte: startOfDay(now), lt: startOfDay(addDays(now, 1)) },
        },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: { organizationId, status: { in: OPEN_TASK_STATUSES } },
        _count: { _all: true },
      }),
      prisma.notification.count({ where: { organizationId, readAt: null } }),
      prisma.notification.findMany({
        where: { organizationId, readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, kind: true, title: true, body: true, createdAt: true },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      revenue: {
        total: toMoney(revenueTotal._sum.total),
        thisMonth: toMoney(revenueThisMonth._sum.total),
        lastMonth: toMoney(revenueLastMonth._sum.total),
        paidInvoices: revenueTotal._count.id,
      },
      receivables: {
        outstanding: toMoney(receivables._sum.total),
        overdue: toMoney(overdue._sum.total),
        openInvoices: receivables._count.id,
      },
      tasks: {
        open: taskCounts,
        overdue: overdueTasks,
        dueToday: dueTodayTasks,
        byPriority: Object.fromEntries(prioritySplit.map((row) => [row.priority, row._count._all])),
      },
      alerts: {
        unread: unreadAlerts,
        recent: recentAlerts.map((alert) => ({
          id: alert.id,
          kind: alert.kind,
          title: alert.title,
          body: alert.body,
          createdAt: alert.createdAt.toISOString(),
        })),
      },
    };
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}

function toMoney(
  value: { toFixed?: (digits?: number) => string } | number | null | undefined,
): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
