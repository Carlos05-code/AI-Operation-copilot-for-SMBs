/**
 * Spacing tokens on a 4px grid (DESIGN_SYSTEM.md §5).
 */

export const spacing = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
  space8: 32,
  space10: 40,
  space12: 48,
} as const;

export type SpacingTokenName = keyof typeof spacing;
