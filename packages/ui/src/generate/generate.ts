/**
 * Platform generators — produce `tokens.css` (web CSS variables), `tokens.dart`
 * (Flutter constants), and `tokens.json` from the TypeScript source of truth.
 *
 * Run via `pnpm build`. Output lands in `generated/`, is committed, and needs no
 * consumer build step.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  colors,
  typography,
  spacing,
  radii,
  elevation,
  motion,
  reduceMotion,
  breakpoints,
} from '../tokens/index.js';
import type { ColorTokenName } from '../tokens/colors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/src/generate/../.. → packages/ui (three segments up from the file)
const packageRoot = path.resolve(__dirname, '..', '..', '..');
const generatedDir = path.join(packageRoot, 'generated');

const toKebab = (s: string): string => s.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
const toPascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const hexUpper = (hex: string): string => hex.replace('#', '').toUpperCase();

/** Shared preamble for all generated files. */
export function header(): string {
  return '// AUTO-GENERATED from packages/ui/src/tokens — DO NOT EDIT. Regenerate with `pnpm build`.';
}

/** CSS: custom properties for light and dark themes. */
export function cssVariables(): string {
  const block = (scheme: 'light' | 'dark'): string[] => {
    const lines: string[] = [];
    for (const name of Object.keys(colors) as ColorTokenName[]) {
      lines.push(`  --color-${toKebab(name)}: ${colors[name][scheme]};`);
    }
    for (const name of Object.keys(spacing)) {
      lines.push(
        `  --space-${name.replace('space', '')}: ${spacing[name as keyof typeof spacing]}px;`,
      );
    }
    for (const name of Object.keys(radii)) {
      const v = radii[name as keyof typeof radii];
      lines.push(`  --radius-${name}: ${typeof v === 'number' ? `${v}px` : v};`);
    }
    for (const name of Object.keys(elevation)) {
      const e = elevation[name as keyof typeof elevation];
      lines.push(`  --elevation-${name}: ${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${e.color};`);
    }
    lines.push(`  --motion-fast-duration: ${motion.fast.durationMs}ms;`);
    lines.push(`  --motion-fast-curve: ${motion.fast.curve};`);
    lines.push(`  --motion-base-duration: ${motion.base.durationMs}ms;`);
    lines.push(`  --motion-base-curve: ${motion.base.curve};`);
    lines.push(`  --motion-slow-duration: ${motion.slow.durationMs}ms;`);
    lines.push(`  --motion-slow-curve: ${motion.slow.curve};`);
    lines.push(`  --breakpoint-compact: ${breakpoints.compact.max}px;`);
    lines.push(`  --breakpoint-medium: ${breakpoints.medium.max}px;`);
    return lines;
  };

  const headerComment = `/* Generated from packages/ui/src/tokens. Regenerate with \`pnpm build\`. */`;
  return (
    `${headerComment}\n` +
    ':root {\n' +
    block('light').join('\n') +
    '\n}\n\n' +
    '[data-theme="dark"] {\n' +
    block('dark').join('\n') +
    '\n}\n\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    '  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }\n' +
    '}\n'
  );
}

/** Flutter: an abstract class of static consts; uses `dart:ui` color import. */
export function dartFile(): string {
  const init = header();
  const colorFields = (scheme: 'light' | 'dark'): string[] =>
    (Object.keys(colors) as ColorTokenName[]).map((n) => {
      const suffix = scheme === 'dark' ? 'Dark' : '';
      return `  static const Color color${toPascal(n)}${suffix} = Color(0xFF${hexUpper(colors[n][scheme])}); // ${colors[n][scheme]}`;
    });

  const lines: string[] = [
    init,
    '',
    '/// AUTO-GENERATED Flutter design tokens. Import via this package.',
    'library;',
    '',
    "import 'dart:ui' show Color;",
    '',
    'abstract class SMBTokens {',
    '  // Color tokens — light scheme (no suffix) and dark scheme (`*Dark`).',
    ...colorFields('light'),
    ...colorFields('dark'),
    '',
    '  // Spacing (4px grid).',
    ...(Object.keys(spacing) as Array<keyof typeof spacing>).map(
      (n) => `  static const double space${toPascal(n.replace('space', ''))} = ${spacing[n]};`,
    ),
    '',
    '  // Radii.',
    ...(Object.keys(radii) as Array<keyof typeof radii>).map((n) => {
      const v = radii[n];
      return `  static const num radius${toPascal(n)} = ${typeof v === 'number' ? v : 'null'}; // ${v}`;
    }),
    '',
    '  // Motion — durations (ms) and easing.',
    `  static const Duration motionFast = Duration(milliseconds: ${motion.fast.durationMs});`,
    `  static const Duration motionBase = Duration(milliseconds: ${motion.base.durationMs});`,
    `  static const Duration motionSlow = Duration(milliseconds: ${motion.slow.durationMs});`,
    `  static const Duration motionEnter = Duration(milliseconds: ${motion.enter.durationMs});`,
    `  static const Duration motionExit = Duration(milliseconds: ${motion.exit.durationMs});`,
    '}',
  ];
  return lines.join('\n');
}

/** Full JSON snapshot of all token groups. */
export function jsonFile(): string {
  return JSON.stringify(
    { colors, typography, spacing, radii, elevation, motion, reduceMotion, breakpoints },
    null,
    2,
  );
}

/** Regenerate committed artifacts under `generated/`. Returns written filenames. */
export function writeGenerated(): string[] {
  fs.mkdirSync(generatedDir, { recursive: true });
  const outputs: Array<[string, string]> = [
    ['tokens.css', cssVariables()],
    ['tokens.dart', dartFile()],
    ['tokens.json', jsonFile()],
  ];
  for (const [filename, content] of outputs) {
    fs.writeFileSync(path.join(generatedDir, filename), content, 'utf8');
  }
  return outputs.map(([filename]) => filename);
}
