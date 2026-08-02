/**
 * Typography tokens (DESIGN_SYSTEM.md §3).
 *
 * Sizes in px, line-height as unitless multipliers. The complete scale maps to
 * Material `TextTheme` extensions client-side; keep tokens primitive.
 */

export type TypographyToken = {
  fontSizePx: number;
  lineHeight: number;
  letterSpacingPx: number;
  fontWeight: 400 | 500 | 600 | 700;
};

/** Every text role used by the design system (DESIGN_SYSTEM.md §3). */
export const typography = {
  display: { fontSizePx: 40, lineHeight: 1.3, letterSpacingPx: -0.5, fontWeight: 700 },
  headlineLarge: { fontSizePx: 28, lineHeight: 1.25, letterSpacingPx: -0.25, fontWeight: 600 },
  headlineMedium: { fontSizePx: 24, lineHeight: 1.25, letterSpacingPx: -0.1, fontWeight: 600 },
  titleLarge: { fontSizePx: 20, lineHeight: 1.3, letterSpacingPx: 0, fontWeight: 600 },
  titleMedium: { fontSizePx: 16, lineHeight: 1.4, letterSpacingPx: 0.15, fontWeight: 500 },
  bodyLarge: { fontSizePx: 16, lineHeight: 1.5, letterSpacingPx: 0, fontWeight: 400 },
  bodyMedium: { fontSizePx: 14, lineHeight: 1.5, letterSpacingPx: 0.15, fontWeight: 400 },
  bodySmall: { fontSizePx: 12, lineHeight: 1.5, letterSpacingPx: 0.2, fontWeight: 400 },
  labelLarge: { fontSizePx: 14, lineHeight: 1.4, letterSpacingPx: 0.1, fontWeight: 600 },
  labelMedium: { fontSizePx: 12, lineHeight: 1.4, letterSpacingPx: 0.3, fontWeight: 600 },
  labelSmall: { fontSizePx: 11, lineHeight: 1.4, letterSpacingPx: 0.4, fontWeight: 500 },
} as const satisfies Record<string, TypographyToken>;

export type TypographyRole = keyof typeof typography;

/** Primary latin font stack with fallbacks (Roboto, system). */
export const fontStack = {
  latin: ['Roboto', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial'],
  cjk: ['Noto Sans SC', 'Microsoft YaHei', 'PingFang SC'],
} as const;
