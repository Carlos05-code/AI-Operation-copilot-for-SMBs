/**
 * Responsive breakpoints (DESIGN_SYSTEM.md §11). Values in px, exclusive upper
 * bound where a breakpoint divides width intervals.
 */

export const breakpoints = {
  compact: { max: 599 },
  medium: { min: 600, max: 1023 },
  expanded: { min: 1024 },
} as const;

export type BreakpointName = keyof typeof breakpoints;
