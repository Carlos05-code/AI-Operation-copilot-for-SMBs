/**
 * Appointment scheduling constants (ROADMAP Phase 3 — appointment
 * scheduling).
 */

/** Guardrails on inbound payloads. */
export const APPOINTMENT_TITLE_MAX_LENGTH = 255;
export const APPOINTMENT_NOTES_MAX_LENGTH = 2000;
/** Sanity bound; also prevents accidental epoch/typo durations. */
export const APPOINTMENT_MAX_DURATION_HOURS = 24;

/** How far ahead the reminder sweep looks for unreminded appointments. */
export const REMINDER_WINDOW_HOURS = 24;
export const REMINDER_SWEEP_BATCH_SIZE = 200;

/** BullMQ job name on the shared `ops-jobs` queue. */
export const JOB_APPOINTMENT_REMINDER_SWEEP = 'appointment.reminder.sweep';

/** Domain events emitted on the transactional outbox. */
export const EVENT_APPOINTMENT_CREATED = 'appointment.created';
export const EVENT_APPOINTMENT_RESCHEDULED = 'appointment.rescheduled';
export const EVENT_APPOINTMENT_STATUS_CHANGED = 'appointment.status_changed';
export const EVENT_APPOINTMENT_REMINDER_SENT = 'appointment.reminder_sent';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
