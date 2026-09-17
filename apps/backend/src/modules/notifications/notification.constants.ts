/**
 * Notification delivery constants (ROADMAP Phase 3 — notifications
 * in-app, WhatsApp, email).
 *
 * `NotificationKind.WHATSAPP` rows deliver via `WhatsAppProvider` (Twilio);
 * everything else (`IN_APP`, `EMAIL`) delivers via `EmailProvider` exactly
 * as before — additive, not a behavior change for existing callers, all of
 * which create `IN_APP` rows today. `WhatsAppProvider` is real and Twilio
 * Sandbox-testable without an approved production sender/templates (see
 * `whatsapp.config.ts`); nothing creates `WHATSAPP`-kind rows yet, so the
 * provider is wired but dormant until a caller opts a specific alert into it
 * — the same state `EMAIL`-kind rows have been in all along.
 */

/** BullMQ job name on the shared `notifications` queue. */
export const JOB_NOTIFICATION_DELIVERY_SWEEP = 'notification.delivery.sweep';

/** Batch size for the periodic delivery sweep. */
export const NOTIFICATION_DELIVERY_BATCH_SIZE = 200;

/** Truncation for the free-text delivery-error column. */
export const DELIVERY_ERROR_MAX_LENGTH = 500;
