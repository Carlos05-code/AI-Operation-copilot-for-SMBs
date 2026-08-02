/**
 * Design tokens for AI Operations Copilot.
 *
 * Single source of truth consumed by Flutter (Dart) and web (CSS/JS). These
 * tokens are AA-verified by the `check-contrast` script (see DESIGN_SYSTEM.md).
 */
export * from './colors.js';
export * from './typography.js';
export * from './spacing.js';
export * from './radii.js';
export * from './elevation.js';
export * from './motion.js';
export * from './breakpoints.js';

/** Pairs used by the CI contrast gate (re-exported for scripts). */
export { tokenPairs as tokenPairsForCheck } from './colors.js';
