/**
 * Elevation / shadow tokens (DESIGN_SYSTEM.md §6). Box-shadows are composed of
 * offset + blur + color(alpha). Dark mode is set by consumer via theme values.
 */

export type ElevationToken = {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
};

export const elevation = {
  shadow1: { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(15, 23, 42, 0.08)' },
  shadow2: { x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(15, 23, 42, 0.12)' },
  shadow3: { x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(15, 23, 42, 0.18)' },
} as const satisfies Record<string, ElevationToken>;

export type ElevationTokenName = keyof typeof elevation;
