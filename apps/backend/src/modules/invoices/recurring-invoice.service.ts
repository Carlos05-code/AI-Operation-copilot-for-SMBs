/**
 * RecurringInvoiceService: CRUD for billing schedules (ROADMAP Phase 3 —
 * recurring invoicing).
 *
 * A schedule stores a validated invoice template (`lineItems` JSON) plus a
 * cadence. The `InvoiceRecurrenceWorker` polls `listDue()` and calls
 * `InvoiceService.generateForRecurring()` for each. Templates are priced with
 * the shared `computeInvoiceTotals` at create time, so a stored template is
 * always structurally valid and the worker can trust it.
 *
 * Everything is org-scoped from the verified token; foreign ids surface as
 * 404. Fail-soft: no database yields the standard 503 contract error.
 */
import { Injectable, Optional } from '@nestjs/common';
import { RecurrenceCadence, type Prisma, type RecurringInvoice } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import {
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_MAX_NET_TERMS_DAYS,
  RECURRENCE_MIN_INTERVAL,
  RECURRENCE_MIN_NET_TERMS_DAYS,
  RECURRENCE_RUN_BATCH_SIZE,
} from './invoice.constants';
import { computeInvoiceTotals, type RawLineItem } from './invoice.totals';

export interface CreateRecurringInvoiceInput {
  organizationId: string;
  customerId: string;
  items: RawLineItem[];
  cadence: RecurrenceCadence;
  interval?: number;
  netTermsDays?: number;
  issueOnCreate?: boolean;
  note?: string | null;
  /** First fire time; defaults to now (the next worker tick generates it). */
  startsAt?: Date;
}

interface TemplateItem {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface RecurringInvoiceView {
  id: string;
  customerId: string;
  cadence: RecurrenceCadence;
  interval: number;
  netTermsDays: number;
  issueOnCreate: boolean;
  active: boolean;
  note: string | null;
  lineItems: TemplateItem[];
  preview: { subtotal: string; taxTotal: string; total: string };
  nextRunAt: string;
  lastRunAt: string | null;
  generatedCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class RecurringInvoiceService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async create(input: CreateRecurringInvoiceInput): Promise<RecurringInvoiceView> {
    const prisma = this.requirePrisma();
    const interval = clampInt(
      input.interval ?? 1,
      RECURRENCE_MIN_INTERVAL,
      RECURRENCE_MAX_INTERVAL,
      'interval',
    );
    const netTermsDays = clampInt(
      input.netTermsDays ?? 30,
      RECURRENCE_MIN_NET_TERMS_DAYS,
      RECURRENCE_MAX_NET_TERMS_DAYS,
      'netTermsDays',
    );
    if (!Object.values(RecurrenceCadence).includes(input.cadence)) {
      throw new ApiError({
        code: HttpErrorCode.VALIDATION_ERROR,
        status: 400,
        message: `'cadence' must be one of: ${Object.values(RecurrenceCadence).join(', ')}`,
      });
    }
    // Validates structure + prices; throws a 400 for a malformed template.
    computeInvoiceTotals(input.items);

    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!customer) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Customer not found in this organization',
      });
    }

    const template = normalizeTemplate(input.items);
    const startsAt = input.startsAt ?? new Date();
    const created = await prisma.recurringInvoice.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        cadence: input.cadence,
        interval,
        netTermsDays,
        issueOnCreate: input.issueOnCreate ?? true,
        note: normalizeNote(input.note),
        lineItems: template as unknown as Prisma.InputJsonValue,
        nextRunAt: startsAt,
      },
    });
    return serializeSchedule(created);
  }

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    items: RecurringInvoiceView[];
    total: number;
  }> {
    const prisma = this.requirePrisma();
    const where: Prisma.RecurringInvoiceWhereInput = { organizationId };
    const [rows, total] = await Promise.all([
      prisma.recurringInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.recurringInvoice.count({ where }),
    ]);
    return { items: rows.map(serializeSchedule), total };
  }

  async get(organizationId: string, id: string): Promise<RecurringInvoiceView> {
    return serializeSchedule(await this.require(organizationId, id));
  }

  /** Pause or resume. Resuming a past-due schedule fires once on the next tick. */
  async setActive(
    organizationId: string,
    id: string,
    active: boolean,
  ): Promise<RecurringInvoiceView> {
    const prisma = this.requirePrisma();
    const schedule = await this.require(organizationId, id);
    const now = new Date();
    const nextRunAt =
      active && schedule.nextRunAt.getTime() < now.getTime() ? now : schedule.nextRunAt;
    const updated = await prisma.recurringInvoice.update({
      where: { id: schedule.id },
      data: { active, nextRunAt },
    });
    return serializeSchedule(updated);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const prisma = this.requirePrisma();
    const schedule = await this.require(organizationId, id);
    await prisma.recurringInvoice.delete({ where: { id: schedule.id } });
  }

  /** Active schedules whose next run is due at or before `now`, oldest first. */
  async listDue(now: Date, limit = RECURRENCE_RUN_BATCH_SIZE): Promise<RecurringInvoice[]> {
    const prisma = this.requirePrisma();
    return prisma.recurringInvoice.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  private async require(organizationId: string, id: string): Promise<RecurringInvoice> {
    const prisma = this.requirePrisma();
    const schedule = await prisma.recurringInvoice.findFirst({ where: { id, organizationId } });
    if (!schedule) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Recurring invoice not found',
      });
    }
    return schedule;
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

function clampInt(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' must be an integer`,
    });
  }
  if (value < min || value > max) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' must be between ${min} and ${max}`,
    });
  }
  return value;
}

function normalizeTemplate(items: RawLineItem[]): TemplateItem[] {
  return items.map((item) => ({
    productId: item.productId ?? null,
    description: (item.description ?? '').trim(),
    quantity: item.quantity as number,
    unitPrice: item.unitPrice as number,
    taxRate: item.taxRate ?? 0,
  }));
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 2000);
}

function serializeSchedule(schedule: RecurringInvoice): RecurringInvoiceView {
  const template = (schedule.lineItems as unknown as TemplateItem[] | null) ?? [];
  const totals = computeInvoiceTotals(template);
  return {
    id: schedule.id,
    customerId: schedule.customerId,
    cadence: schedule.cadence,
    interval: schedule.interval,
    netTermsDays: schedule.netTermsDays,
    issueOnCreate: schedule.issueOnCreate,
    active: schedule.active,
    note: schedule.note,
    lineItems: template,
    preview: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total },
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt ? schedule.lastRunAt.toISOString() : null,
    generatedCount: schedule.generatedCount,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}
