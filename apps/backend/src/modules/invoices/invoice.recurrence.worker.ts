/**
 * InvoiceRecurrenceWorker: consumes `invoice.recurrence.run` jobs on the
 * `ops-jobs` queue (ROADMAP Phase 3 — recurring invoicing).
 *
 * Each run loads the active schedules whose `nextRunAt` is due, and for each
 * asks `InvoiceService.generateForRecurring()` to create the next invoice and
 * advance the schedule in one transaction. The advance is guarded on the
 * observed `nextRunAt`, so a concurrent run that already moved the schedule is
 * detected (`ScheduleRaceError`) and counted as skipped rather than
 * double-billing.
 *
 * Fail-soft: without a database the job is a no-op; a per-schedule error is
 * logged and the loop continues so one bad schedule can't stall the batch.
 * Non-matching job names are skipped (the queue hosts multiple processors).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  EVENT_RECURRING_INVOICE_GENERATED,
  JOB_INVOICE_RECURRENCE_RUN,
  RECURRENCE_RUN_BATCH_SIZE,
} from './invoice.constants';
import { InvoiceService, ScheduleRaceError } from './invoice.service';
import { RecurringInvoiceService } from './recurring-invoice.service';

export interface InvoiceRecurrenceJobData {
  /** Optional cap for a single run; defaults to RECURRENCE_RUN_BATCH_SIZE. */
  limit?: number;
}

export interface InvoiceRecurrenceResult {
  ran: boolean;
  skipped?: string;
  due: number;
  generated: number;
  raced: number;
  failed: number;
}

@Processor(QUEUE_OPS_JOBS)
export class InvoiceRecurrenceWorker extends WorkerHost {
  private readonly logger = new Logger(InvoiceRecurrenceWorker.name);

  constructor(
    private readonly invoices: InvoiceService,
    private readonly schedules: RecurringInvoiceService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<InvoiceRecurrenceJobData>): Promise<InvoiceRecurrenceResult> {
    if (job.name !== JOB_INVOICE_RECURRENCE_RUN) {
      return { ran: false, skipped: 'name mismatch', due: 0, generated: 0, raced: 0, failed: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('invoice recurrence skipped: db not configured');
      return { ran: false, skipped: 'not configured', due: 0, generated: 0, raced: 0, failed: 0 };
    }

    const now = new Date();
    const limit = clampLimit(job.data?.limit);
    const due = await this.schedules.listDue(now, limit);
    if (due.length === 0) {
      return { ran: true, due: 0, generated: 0, raced: 0, failed: 0 };
    }

    let generated = 0;
    let raced = 0;
    let failed = 0;
    for (const schedule of due) {
      try {
        const invoice = await this.invoices.generateForRecurring(schedule, now);
        generated += 1;
        await this.emitGenerated(schedule.id, schedule.organizationId, invoice.id);
      } catch (error) {
        if (error instanceof ScheduleRaceError) {
          raced += 1;
          continue;
        }
        failed += 1;
        this.logger.error(`recurring invoice ${schedule.id} failed: ${(error as Error)?.message}`);
      }
    }

    this.logger.log(
      `invoice recurrence: ${generated} generated, ${raced} raced, ${failed} failed of ${due.length} due`,
    );
    return { ran: true, due: due.length, generated, raced, failed };
  }

  private async emitGenerated(
    scheduleId: string,
    organizationId: string,
    invoiceId: string,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'recurring_invoice',
        aggregateId: scheduleId,
        eventType: EVENT_RECURRING_INVOICE_GENERATED,
        payload: { recurringInvoiceId: scheduleId, organizationId, invoiceId },
      });
    } catch (error) {
      this.logger.warn(`recurrence outbox append skipped: ${(error as Error)?.message}`);
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return RECURRENCE_RUN_BATCH_SIZE;
  }
  return Math.min(Math.trunc(limit), RECURRENCE_RUN_BATCH_SIZE);
}
