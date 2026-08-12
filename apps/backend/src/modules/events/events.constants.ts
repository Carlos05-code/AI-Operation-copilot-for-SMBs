/**
 * Event bus + outbox constants (ADR-0007, BACKEND_SPEC events layout).
 */
export const DOMAIN_EVENTS_EXCHANGE = 'copilot.domain.events';
export const DOMAIN_EVENTS_EXCHANGE_TYPE = 'topic';
export const OUTBOX_POLL_INTERVAL_MS = 5000;
export const OUTBOX_POLL_BATCH_SIZE = 50;
