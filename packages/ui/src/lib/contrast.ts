/**
 * WCAG 2.2 contrast utilities (WCAG 2.1 AA / AAA).
 *
 * - {@link relativeLuminance} — linearized sRGB luminance, WCAG definition.
 * - {@link contrastRatio} — (L1 + 0.05) / (L2 + 0.05), L1 > L2.
 * - {@link meetsAA} / {@link meetsAAA} — threshold checks for text.
 */

/** Convert `#RRGGBB` hex to `{ r, g, b }` in 0..255. Throws on bad input. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    throw new TypeError(`Invalid hex color #RRGGBB, got "${hex}"`);
  }
  const value = match[1] ?? '';
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of an sRGB color (0..1). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG contrast ratio between two colors (1..21). Order-insensitive. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Threshold check helper. */
export function meetsMinimumRatio(ratio: number, threshold: number): boolean {
  return ratio >= threshold;
}

/** WCAG 2.1 AA minimum for normal text. */
export const AA_TEXT_RATIO = 4.5;

/** WCAG 2.1 AA minimum for large text / icons / non-text UI. */
export const AA_LARGE_RATIO = 3.0;

/** True if the pair meets normal-text AA (>= 4.5). */
export function meetsAAText(hexA: string, hexB: string): boolean {
  return contrastRatio(hexA, hexB) >= AA_TEXT_RATIO;
}

/** True if the pair meets large-text/icon AA (>= 3.0). */
export function meetsAALarge(hexA: string, hexB: string): boolean {
  return contrastRatio(hexA, hexB) >= AA_LARGE_RATIO;
}
