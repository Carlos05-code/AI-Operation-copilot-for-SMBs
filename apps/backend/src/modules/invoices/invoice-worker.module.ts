/**
 * InvoicesWorkerModule: the two `ops-jobs` workers from `invoice.module.ts`,
 * split out so `worker-app.module.ts` never instantiates
 * `InvoiceController`/`RecurringInvoiceController` (DEVOPS_SPEC §3).
 * `InvoiceRecurrenceWorker` generates invoices for due schedules;
 * `InvoiceOverdueWorker` flips past-due `SENT` invoices to `OVERDUE` and
 * raises in-app alerts for the org's managers.
 */
import { Module } from '@nestjs/common';
import { InvoiceOverdueWorker } from './invoice.overdue.worker';
import { InvoiceRecurrenceWorker } from './invoice.recurrence.worker';
import { InvoiceService } from './invoice.service';
import { RecurringInvoiceService } from './recurring-invoice.service';

@Module({
  providers: [
    InvoiceService,
    RecurringInvoiceService,
    InvoiceRecurrenceWorker,
    InvoiceOverdueWorker,
  ],
})
export class InvoicesWorkerModule {}
