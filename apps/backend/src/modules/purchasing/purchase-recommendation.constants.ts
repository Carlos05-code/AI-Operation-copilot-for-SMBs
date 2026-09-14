/**
 * Purchase recommendation constants (ROADMAP Phase 3 — purchase
 * recommendations, AI_ARCHITECTURE §6.1 `recommend.reorder`).
 */
export const JOB_PURCHASE_RECOMMEND_SWEEP = 'purchase.recommend.sweep';
export const EVENT_PURCHASE_RECOMMENDED = 'purchase.recommended';
export const PURCHASE_RECOMMEND_PROMPT_VERSION = 'recommend.reorder.v1';

/** How far back the sweep looks for consumption (`OUT`) history. */
export const PURCHASE_RECOMMEND_LOOKBACK_DAYS = 30;

/** Bounds on one sweep run, mirroring the other periodic-sweep workers. */
export const PURCHASE_RECOMMEND_BATCH_SIZE = 200;
export const PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG = 40;
export const PURCHASE_RECOMMEND_MAX_TOKENS = 800;

export const PURCHASE_RECOMMENDATION_STATUSES = ['PENDING', 'ORDERED', 'DISMISSED'] as const;
