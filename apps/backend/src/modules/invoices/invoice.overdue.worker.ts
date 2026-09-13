/**
 * InvoiceOverdueWorker: consumes `invoice.overdue.sweep` jobs on the
 * `ops-jobs` queue (ROADMAP Phase 3 — invoice lifecycle + alerts).
 *
 * Finds `SENT` invoices whose `dueDate` has passed, flips each to `OVERDUE`,
 * and raises an in-app `Notification` for every OWNER/ADMIN/MANAGER of the
 * org — which the executive dashboard already surfaces under `alerts`. The
 * status flip is a guarded `updateMany` (`status: SENT`), so a re-run or a
 * concurrent sweep never re-notifies an invoice that was already moved.
 *
 * Fail-soft: without a database the job is a no-op; a per-invoice error is
 * logged and the loop continues. Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { InvoiceStatus, NotificationKind, Role } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  EVENT_INVOICE_OVERDUE,
  JOB_INVOICE_OVERDUE_SWEEP,
  OVERDUE_SWEEP_BATCH_SIZE,
} from './invoice.constants';

export interface InvoiceOverdueJobData {
  limit?: number;
}

export interface InvoiceOverdueResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  markedOverdue: number;
  notified: number;
}

const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];

@Processor(QUEUE_OPS_JOBS)
export class InvoiceOverdueWorker extends WorkerHost {
  private readonly logger = new Logger(InvoiceOverdueWorker.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<InvoiceOverdueJobData>): Promise<InvoiceOverdueResult> {
    if (job.name !== JOB_INVOICE_OVERDUE_SWEEP) {
      return { ran: false, skipped: 'name mismatch', candidates: 0, markedOverdue: 0, notified: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('invoice overdue sweep skipped: db not configured');
      return {
        ran: false,
        skipped: 'not configured',
        candidates: 0,
        markedOverdue: 0,
        notified: 0,
      };
    }

    const prisma = this.prisma;
    const now = new Date();
    const limit = clampLimit(job.data?.limit);
    const candidates = await prisma.invoice.findMany({
      where: { status: InvoiceStatus.SENT, dueDate: { lt: now } },
      orderBy: { dueDate: 'asc' },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        customerId: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
      },
    });
    if (candidates.length === 0) {
      return { ran: true, candidates: 0, markedOverdue: 0, notified: 0 };
    }

    const recipientsByOrg = new Map<string, string[]>();
    let markedOverdue = 0;
    let notified = 0;

    for (const invoice of candidates) {
      try {
        let recipients = recipientsByOrg.get(invoice.organizationId);
        if (!recipients) {
          const members = await prisma.member.findMany({
            where: { organizationId: invoice.organizationId, role: { in: ALERT_ROLES } },
            select: { userId: true },
          });
          recipients = [...new Set(members.map((member) => member.userId))];
          recipientsByOrg.set(invoice.organizationId, recipients);
        }

        const total = decimalToString(invoice.total);
        const dueOn = invoice.dueDate.toISOString().slice(0, 10);
        const claimed = await prisma.$transaction(async (tx) => {
          const flip = await tx.invoice.updateMany({
            where: { id: invoice.id, status: InvoiceStatus.SENT },
            data: { status: InvoiceStatus.OVERDUE },
          });
          if (flip.count === 0) return false;
          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((userId) => ({
                organizationId: invoice.organizationId,
                userId,
                kind: NotificationKind.IN_APP,
                title: `Invoice ${invoice.invoiceNumber} is overdue`,
                body: `${total} was due on ${dueOn} and is now overdue.`,
                payload: {
                  invoiceId: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  customerId: invoice.customerId,
                  dueDate: invoice.dueDate.toISOString(),
                  total,
                },
              })),
            });
          }
          return true;
        });

        if (!claimed) continue;
        markedOverdue += 1;
        notified += recipients.length;
        await this.emitOverdue(invoice.id, invoice.organizationId, invoice.invoiceNumber, total);
      } catch (error) {
        this.logger.error(
          `overdue sweep failed for invoice ${invoice.id}: ${(error as Error)?.message}`,
        );
      }
    }

    this.logger.log(
      `invoice overdue sweep: ${markedOverdue}/${candidates.length} marked overdue, ${notified} notifications`,
    );
    return { ran: true, candidates: candidates.length, markedOverdue, notified };
  }

  private async emitOverdue(
    invoiceId: string,
    organizationId: string,
    invoiceNumber: string,
    total: string,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'invoice',
        aggregateId: invoiceId,
        eventType: EVENT_INVOICE_OVERDUE,
        payload: { id: invoiceId, organizationId, invoiceNumber, total },
      });
    } catch (error) {
      this.logger.warn(`overdue outbox append skipped: ${(error as Error)?.message}`);
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return OVERDUE_SWEEP_BATCH_SIZE;
  }
  return Math.min(Math.trunc(limit), OVERDUE_SWEEP_BATCH_SIZE);
}

function decimalToString(value: { toFixed?: (digits?: number) => string } | number | null): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}
