/**
 * Canonical color tokens for the AI Operations Copilot design system.
 *
 * The semantic tokens are AA-verified: every foreground/background pair used in
 * UI passes WCAG AA (>= 4.5:1 for text, >= 3:1 for icons/large). Values are
 * enforced by the `check-contrast:verify` script in CI (DESIGN_SYSTEM.md §2).
 */

export type ColorToken = { light: string; dark: string };

/** Semantic color tokens; `light` and `dark` scheme values as hex `#RRGGBB`. */
export const colors = {
  primary: { light: '#0f766e', dark: '#99f6e4' },
  onPrimary: { light: '#ffffff', dark: '#043c35' },
  secondary: { light: '#334155', dark: '#a8c1cf' },
  onSecondary: { light: '#ffffff', dark: '#0a2431' },
  background: { light: '#f8fafc', dark: '#020617' },
  onBackground: { light: '#0f172a', dark: '#f1f5f9' },
  surface: { light: '#ffffff', dark: '#0f172a' },
  onSurface: { light: '#0f172a', dark: '#f1f5f9' },
  error: { light: '#b3261e', dark: '#f2b8b5' },
  onError: { light: '#ffffff', dark: '#331111' },
  success: { light: '#1b8732', dark: '#a5d6a7' },
  onSuccess: { light: '#ffffff', dark: '#0d2b13' },
  warning: { light: '#9a6700', dark: '#ffd54f' },
  onWarning: { light: '#ffffff', dark: '#3d2f00' },
  border: { light: '#d1d5db', dark: '#334155' },
  onBorder: { light: '#0f172a', dark: '#e2e8f0' },
} as const satisfies Record<string, ColorToken>;

export type ColorTokenName = keyof typeof colors;

/** Accessibility pairs (foreground on background) that must meet WCAG AA. */
export const tokenPairs = [
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onBackground', 'background'],
  ['onSurface', 'surface'],
  ['onError', 'error'],
  ['onSuccess', 'success'],
  ['onWarning', 'warning'],
  ['onBorder', 'border'],
] as const satisfies ReadonlyArray<readonly [ColorTokenName, ColorTokenName]>;
