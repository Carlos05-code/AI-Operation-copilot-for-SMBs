/**
 * Notification delivery constants (ROADMAP Phase 3 — notifications
 * in-app, WhatsApp, email).
 *
 * WhatsApp outbound delivery is deferred: it needs a WhatsApp Business API
 * (or Twilio) integration with an approved sender and message templates,
 * none of which exist in this environment. Building a provider that can
 * never be exercised against a real API would be a stub, which the project
 * principles rule out — so only email delivery ships here; `NotificationKind`
 * keeps the `WHATSAPP` value reserved for that future provider.
 */

/** BullMQ job name on the shared `notifications` queue. */
export const JOB_NOTIFICATION_DELIVERY_SWEEP = 'notification.delivery.sweep';

/** Batch size for the periodic delivery sweep. */
export const NOTIFICATION_DELIVERY_BATCH_SIZE = 200;

/** Truncation for the free-text delivery-error column. */
export const DELIVERY_ERROR_MAX_LENGTH = 500;
