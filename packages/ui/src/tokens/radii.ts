/**
 * Corner radius and shape tokens (DESIGN_SYSTEM.md §4).
 */

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  circle: '50%',
} as const;

export type RadiusTokenName = keyof typeof radii;
