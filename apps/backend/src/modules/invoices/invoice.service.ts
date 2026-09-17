/**
 * InvoiceService: invoice generation + lifecycle (ROADMAP Phase 3,
 * API_SPEC §11.1).
 *
 * `POST /invoices` prices the submitted line items (integer-cent math),
 * allocates a per-org, per-year invoice number (`INV-<year>-<seq>`, via an
 * atomic counter — see `InvoiceNumberCounter` — so concurrent creates can
 * never collide), and writes the invoice + items in one transaction.
 * Lifecycle transitions (`issue`, `pay`, `void`) are an explicit state
 * machine — an illegal transition is a 409, never a silent no-op.
 *
 * Every mutation appends a domain event to the transactional outbox
 * (best-effort: a bus/outbox failure is logged, never fatal — the row is the
 * system of record). Fail-soft: with no database the surface returns the
 * standard 503 contract error.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InvoiceStatus, type Invoice, type Prisma, type RecurringInvoice } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import {
  EVENT_INVOICE_CREATED,
  EVENT_INVOICE_ISSUED,
  EVENT_INVOICE_PAID,
  EVENT_INVOICE_VOIDED,
  INVOICE_NOTE_MAX_LENGTH,
} from './invoice.constants';
import {
  addDaysUtc,
  advancePastNow,
  computeInvoiceTotals,
  formatInvoiceNumber,
  type InvoiceTotals,
  type RawLineItem,
} from './invoice.totals';

export interface CreateInvoiceInput {
  organizationId: string;
  customerId: string;
  items: RawLineItem[];
  dueDate: Date;
  note?: string | null;
  /** When true the invoice is created already `SENT` (issuedAt set). */
  issue?: boolean;
}

export interface InvoiceItemView {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  customerId: string;
  recurringInvoiceId: string | null;
  status: InvoiceStatus;
  note: string | null;
  dueDate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItemView[];
}

export interface InvoiceListResult {
  items: InvoiceView[];
  total: number;
}

const INVOICE_WITH_ITEMS = {
  items: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;

/** Legal lifecycle transitions (source status → allowed target statuses). */
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: [InvoiceStatus.SENT, InvoiceStatus.VOID],
  SENT: [InvoiceStatus.PAID, InvoiceStatus.OVERDUE, InvoiceStatus.VOID],
  OVERDUE: [InvoiceStatus.PAID, InvoiceStatus.VOID],
  PAID: [],
  VOID: [],
};

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /** Prices, numbers, and persists a new invoice for the org. */
  async create(input: CreateInvoiceInput): Promise<InvoiceView> {
    this.requirePrisma();
    const note = normalizeNote(input.note);
    const totals = computeInvoiceTotals(input.items);
    await this.assertCustomer(input.organizationId, input.customerId);
    await this.assertProducts(input.organizationId, totals);

    const now = new Date();
    const invoice = await this.insertInvoice({
      organizationId: input.organizationId,
      customerId: input.customerId,
      recurringInvoiceId: null,
      dueDate: input.dueDate,
      note,
      totals,
      status: input.issue ? InvoiceStatus.SENT : InvoiceStatus.DRAFT,
      issuedAt: input.issue ? now : null,
      when: now,
    });

    await this.emit(invoice, EVENT_INVOICE_CREATED, {
      status: invoice.status,
      total: totals.total,
      issued: Boolean(input.issue),
    });
    return this.load(input.organizationId, invoice.id);
  }

  /**
   * Generates the next invoice for a due recurring schedule and advances the
   * schedule's `nextRunAt` in the same transaction. Throws `ScheduleRaceError`
   * (nothing written) when a concurrent run already moved the schedule.
   */
  async generateForRecurring(schedule: RecurringInvoice, now: Date): Promise<InvoiceView> {
    const totals = computeInvoiceTotals(schedule.lineItems as unknown as RawLineItem[]);
    const invoice = await this.insertInvoice({
      organizationId: schedule.organizationId,
      customerId: schedule.customerId,
      recurringInvoiceId: schedule.id,
      dueDate: addDaysUtc(now, schedule.netTermsDays),
      note: schedule.note ?? null,
      totals,
      status: schedule.issueOnCreate ? InvoiceStatus.SENT : InvoiceStatus.DRAFT,
      issuedAt: schedule.issueOnCreate ? now : null,
      when: now,
      afterInTx: async (tx) => {
        const advanced = await tx.recurringInvoice.updateMany({
          where: { id: schedule.id, nextRunAt: schedule.nextRunAt, active: true },
          data: {
            nextRunAt: advancePastNow(schedule.cadence, schedule.interval, schedule.nextRunAt, now),
            lastRunAt: now,
            generatedCount: { increment: 1 },
          },
        });
        if (advanced.count === 0) {
          throw new ScheduleRaceError(schedule.id);
        }
      },
    });

    await this.emit(invoice, EVENT_INVOICE_CREATED, {
      status: invoice.status,
      total: totals.total,
      recurringInvoiceId: schedule.id,
    });
    return this.load(schedule.organizationId, invoice.id);
  }

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    status?: InvoiceStatus,
  ): Promise<InvoiceListResult> {
    const prisma = this.requirePrisma();
    const where: Prisma.InvoiceWhereInput = { organizationId, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);
    return { items: rows.map((row) => serializeInvoice(row)), total };
  }

  async get(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.load(organizationId, invoiceId);
  }

  /** DRAFT → SENT. */
  async issue(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.transition(organizationId, invoiceId, InvoiceStatus.SENT, EVENT_INVOICE_ISSUED, {
      issuedAt: new Date(),
    });
  }

  /** SENT | OVERDUE → PAID. */
  async markPaid(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.transition(organizationId, invoiceId, InvoiceStatus.PAID, EVENT_INVOICE_PAID, {
      paidAt: new Date(),
    });
  }

  /** DRAFT | SENT | OVERDUE → VOID. */
  async voidInvoice(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.transition(organizationId, invoiceId, InvoiceStatus.VOID, EVENT_INVOICE_VOIDED, {});
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async transition(
    organizationId: string,
    invoiceId: string,
    target: InvoiceStatus,
    event: string,
    extra: Prisma.InvoiceUpdateInput,
  ): Promise<InvoiceView> {
    const prisma = this.requirePrisma();
    const current = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, status: true },
    });
    if (!current) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Invoice not found',
      });
    }
    if (current.status === target) {
      return this.load(organizationId, invoiceId);
    }
    if (!TRANSITIONS[current.status].includes(target)) {
      throw new ApiError({
        code: HttpErrorCode.CONFLICT,
        status: 409,
        message: `Cannot move invoice from ${current.status} to ${target}`,
      });
    }
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: target, ...extra },
    });
    await this.emit(updated, event, { from: current.status, to: target });
    return this.load(organizationId, invoiceId);
  }

  private async insertInvoice(params: {
    organizationId: string;
    customerId: string;
    recurringInvoiceId: string | null;
    dueDate: Date;
    note: string | null;
    totals: InvoiceTotals;
    status: InvoiceStatus;
    issuedAt: Date | null;
    when: Date;
    afterInTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  }): Promise<Invoice> {
    const prisma = this.requirePrisma();
    const year = params.when.getUTCFullYear();

    return prisma.$transaction(async (tx) => {
      // Atomic per-org, per-year counter (a single `INSERT ... ON CONFLICT DO UPDATE` on
      // Postgres) — concurrent creates for the same org/year each get a distinct, strictly
      // increasing value, so invoiceNumber can never collide. Counting existing rows first
      // (the previous approach) raced under concurrency: many requests could read the same
      // count before any of them committed, all generating the same number.
      const counter = await tx.invoiceNumberCounter.upsert({
        where: { organizationId_year: { organizationId: params.organizationId, year } },
        create: { organizationId: params.organizationId, year, value: 1 },
        update: { value: { increment: 1 } },
      });
      const invoiceNumber = formatInvoiceNumber(year, counter.value);

      const invoice = await tx.invoice.create({
        data: {
          organizationId: params.organizationId,
          customerId: params.customerId,
          recurringInvoiceId: params.recurringInvoiceId,
          invoiceNumber,
          dueDate: params.dueDate,
          note: params.note,
          status: params.status,
          issuedAt: params.issuedAt,
          subtotal: params.totals.subtotal,
          taxTotal: params.totals.taxTotal,
          total: params.totals.total,
          items: {
            create: params.totals.items.map((item) => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: item.taxRate,
              lineTotal: item.lineTotal,
            })),
          },
        },
      });
      if (params.afterInTx) await params.afterInTx(tx);
      return invoice;
    });
  }

  private async assertCustomer(organizationId: string, customerId: string): Promise<void> {
    const prisma = this.requirePrisma();
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });
    if (!customer) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Customer not found in this organization',
      });
    }
  }

  private async assertProducts(organizationId: string, totals: InvoiceTotals): Promise<void> {
    const productIds = [
      ...new Set(
        totals.items
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (productIds.length === 0) return;
    const prisma = this.requirePrisma();
    const found = await prisma.product.count({
      where: { id: { in: productIds }, organizationId },
    });
    if (found !== productIds.length) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'One or more line-item products do not belong to this organization',
      });
    }
  }

  private async load(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    const prisma = this.requirePrisma();
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: INVOICE_WITH_ITEMS,
    });
    if (!invoice) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Invoice not found',
      });
    }
    return serializeInvoice(invoice);
  }

  private async emit(invoice: Invoice, eventType: string, extra: Prisma.JsonObject): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        eventType,
        payload: {
          id: invoice.id,
          organizationId: invoice.organizationId,
          customerId: invoice.customerId,
          invoiceNumber: invoice.invoiceNumber,
          ...extra,
        },
      });
    } catch (error) {
      this.logger.warn(`invoice outbox append skipped: ${(error as Error)?.message}`);
    }
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

/** Thrown inside a transaction when a concurrent run already claimed a schedule. */
export class ScheduleRaceError extends Error {
  constructor(scheduleId: string) {
    super(`recurring invoice ${scheduleId} was already advanced by a concurrent run`);
    this.name = 'ScheduleRaceError';
  }
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, INVOICE_NOTE_MAX_LENGTH);
}

type InvoiceRow = Invoice & { items?: import('@prisma/client').InvoiceItem[] };

function serializeInvoice(invoice: InvoiceRow): InvoiceView {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    recurringInvoiceId: invoice.recurringInvoiceId,
    status: invoice.status,
    note: invoice.note,
    dueDate: invoice.dueDate.toISOString(),
    subtotal: decimalToString(invoice.subtotal),
    taxTotal: decimalToString(invoice.taxTotal),
    total: decimalToString(invoice.total),
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    ...(invoice.items
      ? {
          items: invoice.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: decimalToString(item.unitPrice),
            taxRate: decimalToString(item.taxRate),
            lineTotal: decimalToString(item.lineTotal),
          })),
        }
      : {}),
  };
}

function decimalToString(value: { toFixed?: (digits?: number) => string } | number | null): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}
