/**
 * Pure money + schedule helpers for the invoices module (no I/O).
 *
 * Money is computed in integer minor units (cents) to avoid binary-float
 * drift, then rendered as fixed 2-decimal strings for Prisma `Decimal`
 * columns — the same string contract the dashboard and API responses use.
 */
import type { RecurrenceCadence } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import {
  INVOICE_DESCRIPTION_MAX_LENGTH,
  INVOICE_MAX_LINE_ITEMS,
  INVOICE_MAX_TAX_RATE,
  INVOICE_NUMBER_PREFIX,
  INVOICE_NUMBER_SEQ_WIDTH,
} from './invoice.constants';

export interface RawLineItem {
  productId?: string | null;
  description?: string;
  quantity?: number;
  /** Unit price in major currency units (e.g. dollars), not cents. */
  unitPrice?: number;
  /** Tax rate as a percentage in [0, 100]. Defaults to 0. */
  taxRate?: number;
}

export interface PricedLineItem {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  taxRate: string;
  /** quantity × unitPrice, before tax. */
  lineTotal: string;
}

export interface InvoiceTotals {
  items: PricedLineItem[];
  subtotal: string;
  taxTotal: string;
  total: string;
}

function invalid(message: string): never {
  throw new ApiError({ code: HttpErrorCode.VALIDATION_ERROR, status: 400, message });
}

function toCents(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`'${field}' must be a finite number`);
  }
  if (value < 0) invalid(`'${field}' must not be negative`);
  return Math.round(value * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Validates and prices a set of raw line items. Throws a 400 `ApiError` for
 * any structural problem so controllers and workers share one rule set.
 */
export function computeInvoiceTotals(rawItems: readonly RawLineItem[]): InvoiceTotals {
  const list: readonly RawLineItem[] = Array.isArray(rawItems) ? rawItems : [];
  if (list.length === 0) {
    invalid('An invoice needs at least one line item');
  }
  if (list.length > INVOICE_MAX_LINE_ITEMS) {
    invalid(`An invoice cannot exceed ${INVOICE_MAX_LINE_ITEMS} line items`);
  }

  let subtotalCents = 0;
  let taxCents = 0;
  const items: PricedLineItem[] = list.map((raw, index) => {
    const label = `items[${index}]`;
    const description = (raw.description ?? '').trim();
    if (description.length === 0) invalid(`${label}.description is required`);
    if (description.length > INVOICE_DESCRIPTION_MAX_LENGTH) {
      invalid(`${label}.description exceeds ${INVOICE_DESCRIPTION_MAX_LENGTH} characters`);
    }
    if (!Number.isInteger(raw.quantity) || (raw.quantity as number) <= 0) {
      invalid(`${label}.quantity must be a positive integer`);
    }
    const quantity = raw.quantity as number;
    const unitPriceCents = toCents(raw.unitPrice as number, `${label}.unitPrice`);
    const taxRate = raw.taxRate ?? 0;
    if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0) {
      invalid(`${label}.taxRate must be a non-negative number`);
    }
    if (taxRate > INVOICE_MAX_TAX_RATE) {
      invalid(`${label}.taxRate cannot exceed ${INVOICE_MAX_TAX_RATE}`);
    }

    const lineTotalCents = unitPriceCents * quantity;
    const lineTaxCents = Math.round((lineTotalCents * taxRate) / 100);
    subtotalCents += lineTotalCents;
    taxCents += lineTaxCents;

    return {
      productId: raw.productId ?? null,
      description,
      quantity,
      unitPrice: fromCents(unitPriceCents),
      taxRate: taxRate.toFixed(2),
      lineTotal: fromCents(lineTotalCents),
    };
  });

  return {
    items,
    subtotal: fromCents(subtotalCents),
    taxTotal: fromCents(taxCents),
    total: fromCents(subtotalCents + taxCents),
  };
}

/** `INV-2026-0042` for org sequence 42 in 2026. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(sequence).padStart(INVOICE_NUMBER_SEQ_WIDTH, '0')}`;
}

/** Adds whole months in UTC, clamping the day to the target month's length. */
export function addMonthsUtc(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/** The next fire time for a schedule, advancing from `from` by one period. */
export function nextRunDate(cadence: RecurrenceCadence, interval: number, from: Date): Date {
  const step = Math.max(1, Math.trunc(interval));
  switch (cadence) {
    case 'WEEKLY':
      return new Date(from.getTime() + step * 7 * 24 * 60 * 60 * 1000);
    case 'MONTHLY':
      return addMonthsUtc(from, step);
    case 'QUARTERLY':
      return addMonthsUtc(from, step * 3);
    case 'YEARLY':
      return addMonthsUtc(from, step * 12);
    default:
      return addMonthsUtc(from, step);
  }
}

/** Advances `nextRunAt` past `now` so a paused/backlogged schedule doesn't storm. */
export function advancePastNow(
  cadence: RecurrenceCadence,
  interval: number,
  from: Date,
  now: Date,
): Date {
  let next = nextRunDate(cadence, interval, from);
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard < 240) {
    next = nextRunDate(cadence, interval, next);
    guard += 1;
  }
  return next;
}

/** Adds whole days in UTC (used for invoice due dates from net terms). */
export function addDaysUtc(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
