/**
 * InvoicesModule: invoice generation, lifecycle, and recurring-invoice CRUD
 * (ROADMAP Phase 3, API_SPEC §11.1). HTTP-only — the recurrence-generation
 * and overdue-sweep workers live in `invoice-worker.module.ts`
 * (DEVOPS_SPEC §3). Surfaces `/invoices` and `/recurring-invoices`.
 * PrismaService, OutboxService, and QueueService come from their global
 * modules; every component is fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';

@Module({
  controllers: [InvoiceController, RecurringInvoiceController],
  providers: [InvoiceService, RecurringInvoiceService],
  exports: [InvoiceService, RecurringInvoiceService],
})
export class InvoicesModule {}
