/**
 * Contrast verification for the design system (CI gate).
 *
 * Verifies every foreground/background pair required by DESIGN_SYSTEM.md §2
 * meets WCAG 2.1 AA (>= 4.5 for text; large/icon pairs are reported at 3.0 but
 * the hard gate uses 4.5 for all pairs). Exits non-zero on any failure.
 *
 * Run: `pnpm test` (after build) or `node dist/scripts/check-contrast.js`.
 */
import { colors, tokenPairs } from '../src/tokens/colors.js';
import { contrastRatio, AA_TEXT_RATIO } from '../src/lib/contrast.js';

interface Failure {
  fg: string;
  bg: string;
  fgColor: string;
  bgColor: string;
  ratio: number;
}

function checkScheme(scheme: 'light' | 'dark'): Failure[] {
  const failures: Failure[] = [];
  for (const [fgName, bgName] of tokenPairs) {
    const fgColor = colors[fgName][scheme];
    const bgColor = colors[bgName][scheme];
    const ratio = contrastRatio(fgColor, bgColor);
    if (ratio < AA_TEXT_RATIO) {
      failures.push({ fg: fgName, bg: bgName, fgColor, bgColor, ratio });
    }
  }
  return failures;
}

function main(): number {
  let exit = 0;
  for (const scheme of ['light', 'dark'] as const) {
    const failures = checkScheme(scheme);
    if (failures.length > 0) {
      exit = 1;
      console.error(`[contrast] ${scheme} scheme FAILURES (AA text ${AA_TEXT_RATIO}:1):`);
      for (const f of failures) {
        console.error(
          `  ${f.fg} (${f.fgColor}) on ${f.bg} (${f.bgColor}) → ${f.ratio.toFixed(2)}:1`,
        );
      }
    } else {
      console.log(
        `[contrast] ${scheme} scheme: all ${tokenPairs.length} pairs ≥ ${AA_TEXT_RATIO}:1 — OK`,
      );
    }
  }
  if (exit === 0) {
    console.log('[contrast] all token pairs meet the WCAG AA text threshold.');
  }
  return exit;
}

process.exit(main());
