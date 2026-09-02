/**
 * Unit tests — invoice money + schedule helpers (pure).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import {
  addDaysUtc,
  addMonthsUtc,
  advancePastNow,
  computeInvoiceTotals,
  formatInvoiceNumber,
  nextRunDate,
} from './invoice.totals';

describe('computeInvoiceTotals', () => {
  it('prices a single line item without tax', () => {
    const totals = computeInvoiceTotals([{ description: 'Beans', quantity: 3, unitPrice: 18.5 }]);
    expect(totals).toEqual({
      items: [
        {
          productId: null,
          description: 'Beans',
          quantity: 3,
          unitPrice: '18.50',
          taxRate: '0.00',
          lineTotal: '55.50',
        },
      ],
      subtotal: '55.50',
      taxTotal: '0.00',
      total: '55.50',
    });
  });

  it('sums multiple items and per-line tax in integer cents', () => {
    const totals = computeInvoiceTotals([
      { productId: 'p1', description: 'A', quantity: 2, unitPrice: 10, taxRate: 8.25 },
      { description: 'B', quantity: 1, unitPrice: 4.99, taxRate: 0 },
    ]);
    // line A: 20.00 + 1.65 tax; line B: 4.99 + 0
    expect(totals.subtotal).toBe('24.99');
    expect(totals.taxTotal).toBe('1.65');
    expect(totals.total).toBe('26.64');
    expect(totals.items[0].productId).toBe('p1');
  });

  it('rejects an empty item list', () => {
    expect(() => computeInvoiceTotals([])).toThrow(
      expect.objectContaining({ code: HttpErrorCode.VALIDATION_ERROR, status: 400 }),
    );
  });

  it('rejects negative price, non-integer quantity, blank description, and tax over 100', () => {
    expect(() => computeInvoiceTotals([{ description: 'x', quantity: 1, unitPrice: -1 }])).toThrow(
      /must not be negative/,
    );
    expect(() => computeInvoiceTotals([{ description: 'x', quantity: 1.5, unitPrice: 1 }])).toThrow(
      /positive integer/,
    );
    expect(() => computeInvoiceTotals([{ description: '  ', quantity: 1, unitPrice: 1 }])).toThrow(
      /description is required/,
    );
    expect(() =>
      computeInvoiceTotals([{ description: 'x', quantity: 1, unitPrice: 1, taxRate: 101 }]),
    ).toThrow(/cannot exceed 100/);
  });
});

describe('formatInvoiceNumber', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatInvoiceNumber(2026, 42)).toBe('INV-2026-0042');
    expect(formatInvoiceNumber(2026, 12345)).toBe('INV-2026-12345');
  });
});

describe('addMonthsUtc', () => {
  it('clamps the day to the target month length', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2024-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('rolls the year over', () => {
    expect(addMonthsUtc(new Date('2026-11-15T09:30:00Z'), 3).toISOString()).toBe(
      '2027-02-15T09:30:00.000Z',
    );
  });
});

describe('nextRunDate', () => {
  const from = new Date('2026-03-10T08:00:00Z');
  it('advances by cadence × interval', () => {
    expect(nextRunDate('WEEKLY', 2, from).toISOString()).toBe('2026-03-24T08:00:00.000Z');
    expect(nextRunDate('MONTHLY', 1, from).toISOString()).toBe('2026-04-10T08:00:00.000Z');
    expect(nextRunDate('QUARTERLY', 1, from).toISOString()).toBe('2026-06-10T08:00:00.000Z');
    expect(nextRunDate('YEARLY', 1, from).toISOString()).toBe('2027-03-10T08:00:00.000Z');
  });
});

describe('advancePastNow', () => {
  it('skips periods until strictly after now', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-03-15T00:00:00Z');
    // monthly from Jan 1 -> Feb 1 -> Mar 1 -> Apr 1 (first past Mar 15)
    expect(advancePastNow('MONTHLY', 1, from, now).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('returns the immediate next period when it is already in the future', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const now = new Date('2026-03-15T00:00:00Z');
    expect(advancePastNow('MONTHLY', 1, from, now).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('addDaysUtc', () => {
  it('adds whole days', () => {
    expect(addDaysUtc(new Date('2026-03-10T08:00:00Z'), 30).toISOString()).toBe(
      '2026-04-09T08:00:00.000Z',
    );
  });
});
