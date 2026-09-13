/**
 * Invoice + recurring-invoice constants (ROADMAP Phase 3, API_SPEC §11.1).
 */

/** `INV-<year>-<seq>`; the sequence is zero-padded to this width. */
export const INVOICE_NUMBER_PREFIX = 'INV';
export const INVOICE_NUMBER_SEQ_WIDTH = 4;
/** Retries when a concurrent create claims the same generated number. */
export const INVOICE_NUMBER_MAX_ATTEMPTS = 5;

/** Guardrails on inbound invoice payloads. */
export const INVOICE_MAX_LINE_ITEMS = 200;
export const INVOICE_MAX_TAX_RATE = 100;
export const INVOICE_DESCRIPTION_MAX_LENGTH = 500;
export const INVOICE_NOTE_MAX_LENGTH = 2000;

/** Recurrence schedule bounds. */
export const RECURRENCE_MIN_INTERVAL = 1;
export const RECURRENCE_MAX_INTERVAL = 24;
export const RECURRENCE_MIN_NET_TERMS_DAYS = 0;
export const RECURRENCE_MAX_NET_TERMS_DAYS = 365;

/** Batch sizes for the background workers. */
export const RECURRENCE_RUN_BATCH_SIZE = 50;
export const OVERDUE_SWEEP_BATCH_SIZE = 200;

/** BullMQ job names on the `ops-jobs` queue. */
export const JOB_INVOICE_RECURRENCE_RUN = 'invoice.recurrence.run';
export const JOB_INVOICE_OVERDUE_SWEEP = 'invoice.overdue.sweep';

/** Domain events emitted on the transactional outbox. */
export const EVENT_INVOICE_CREATED = 'invoice.created';
export const EVENT_INVOICE_ISSUED = 'invoice.issued';
export const EVENT_INVOICE_PAID = 'invoice.paid';
export const EVENT_INVOICE_VOIDED = 'invoice.voided';
export const EVENT_INVOICE_OVERDUE = 'invoice.overdue';
export const EVENT_RECURRING_INVOICE_GENERATED = 'invoice.recurrence.generated';

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'] as const;
export const RECURRENCE_CADENCES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
