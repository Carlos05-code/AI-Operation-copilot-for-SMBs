/**
 * InvoicesModule: invoice generation, lifecycle, recurring invoicing, and the
 * overdue sweep (ROADMAP Phase 3, API_SPEC §11.1).
 *
 * Surfaces `/invoices` and `/recurring-invoices`. Two `ops-jobs` workers run
 * the background side: `InvoiceRecurrenceWorker` generates invoices for due
 * schedules; `InvoiceOverdueWorker` flips past-due `SENT` invoices to
 * `OVERDUE` and raises in-app alerts for the org's managers. PrismaService,
 * OutboxService, and QueueService come from their global modules; every
 * component is fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceOverdueWorker } from './invoice.overdue.worker';
import { InvoiceRecurrenceWorker } from './invoice.recurrence.worker';
import { InvoiceService } from './invoice.service';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';

@Module({
  controllers: [InvoiceController, RecurringInvoiceController],
  providers: [
    InvoiceService,
    RecurringInvoiceService,
    InvoiceRecurrenceWorker,
    InvoiceOverdueWorker,
  ],
  exports: [InvoiceService, RecurringInvoiceService],
})
export class InvoicesModule {}
