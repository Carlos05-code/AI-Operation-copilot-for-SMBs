/**
 * Purchase recommendation constants (ROADMAP Phase 3 — purchase
 * recommendations; Phase 4 v2 — demand-aware, AI_ARCHITECTURE §6.1
 * `recommend.reorder`).
 */
export const JOB_PURCHASE_RECOMMEND_SWEEP = 'purchase.recommend.sweep';
export const EVENT_PURCHASE_RECOMMENDED = 'purchase.recommended';
export const PURCHASE_RECOMMEND_PROMPT_VERSION = 'recommend.reorder.v2';

/**
 * Length of each consumption (`OUT`) window the sweep compares — the
 * trailing period against the one before it, to classify demand as
 * increasing/decreasing/stable (v2's "demand-aware" signal).
 */
export const PURCHASE_RECOMMEND_LOOKBACK_DAYS = 30;

/** Fractional swing between the two periods needed to call it a trend, not noise. */
export const PURCHASE_RECOMMEND_TREND_THRESHOLD = 0.15;

/** Bounds on one sweep run, mirroring the other periodic-sweep workers. */
export const PURCHASE_RECOMMEND_BATCH_SIZE = 200;
export const PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG = 40;
export const PURCHASE_RECOMMEND_MAX_TOKENS = 800;

export const PURCHASE_RECOMMENDATION_STATUSES = ['PENDING', 'ORDERED', 'DISMISSED'] as const;
export const PURCHASE_RECOMMEND_TRENDS = ['increasing', 'decreasing', 'stable'] as const;
