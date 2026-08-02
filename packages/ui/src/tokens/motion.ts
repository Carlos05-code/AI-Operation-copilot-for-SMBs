/**
 * Motion tokens (DESIGN_SYSTEM.md §8). Durations in ms; curves are
 * cubic-bezier definitions. `reduceMotion` disables non-essential animation.
 */

export type MotionToken = {
  durationMs: number;
  curve: string;
};

export const motion = {
  fast: { durationMs: 120, curve: 'cubic-bezier(0.0, 0.0, 0.2, 1)' },
  base: { durationMs: 200, curve: 'cubic-bezier(0.4, 0.0, 0.2, 1)' },
  slow: { durationMs: 320, curve: 'cubic-bezier(0.0, 0.0, 0.2, 1)' },
  enter: { durationMs: 240, curve: 'cubic-bezier(0.4, 0.0, 1, 1)' },
  exit: { durationMs: 180, curve: 'cubic-bezier(0, 0, 1, 1)' },
} as const satisfies Record<string, MotionToken>;

export type MotionTokenName = keyof typeof motion;

/** When true, animation is reduced per system setting. */
export const reduceMotion = {
  durationMs: 0,
  curve: 'linear',
} as const;
