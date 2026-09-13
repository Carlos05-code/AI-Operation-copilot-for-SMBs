/**
 * Product + inventory constants (ROADMAP Phase 3 — inventory tracking with
 * reorder alerts).
 */

/** Guardrails on inbound product payloads. */
export const PRODUCT_NAME_MAX_LENGTH = 255;
export const PRODUCT_SKU_MAX_LENGTH = 64;
export const PRODUCT_MAX_PRICE = 100_000_000;
export const PRODUCT_MAX_REORDER_POINT = 1_000_000;

/** Guardrails on inbound movement payloads. */
export const MOVEMENT_MAX_QUANTITY = 1_000_000;
export const MOVEMENT_NOTE_MAX_LENGTH = 500;

/** Batch size for the periodic reorder-alert sweep. */
export const REORDER_SWEEP_BATCH_SIZE = 200;

/** BullMQ job name on the shared `ops-jobs` queue. */
export const JOB_INVENTORY_REORDER_SWEEP = 'inventory.reorder.sweep';

/** Domain events emitted on the transactional outbox. */
export const EVENT_PRODUCT_CREATED = 'product.created';
export const EVENT_INVENTORY_MOVEMENT_RECORDED = 'inventory.movement_recorded';
export const EVENT_INVENTORY_REORDER_ALERT = 'inventory.reorder_alert';
export const EVENT_INVENTORY_RESTOCKED = 'inventory.restocked';

export const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST'] as const;
