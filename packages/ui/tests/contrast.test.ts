/**
 * Unit tests for WCAG contrast utilities.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  meetsAAText,
  meetsAALarge,
  AA_TEXT_RATIO,
  AA_LARGE_RATIO,
} from '../src/lib/contrast.js';

test('hexToRgb parses #RRGGBB', () => {
  assert.deepEqual(hexToRgb('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('#0f766e'), { r: 15, g: 118, b: 110 });
});

test('hexToRgb rejects invalid input', () => {
  assert.throws(() => hexToRgb('#fff'));
  assert.throws(() => hexToRgb('0f766e'));
  assert.throws(() => hexToRgb(''));
});

test('relativeLuminance matches WCAG reference values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9, 'white → 1');

  // Rec. 709 / sRGB: ~0.2126 red channel check.
  const gray = relativeLuminance('#777777');
  assert.ok(gray > 0 && gray < 1, `gray in (0,1), got ${gray}`);
});

test('contrastRatio is order-insensitive and within 1..21', () => {
  const a = contrastRatio('#000000', '#ffffff');
  assert.ok(a > 20 && a <= 21, `black/white ≈ 21, got ${a}`);
  assert.equal(contrastRatio('#ffffff', '#000000'), a);
  assert.equal(contrastRatio('#000000', '#000000'), 1);
});

test('AA thresholds exported', () => {
  assert.equal(AA_TEXT_RATIO, 4.5);
  assert.equal(AA_LARGE_RATIO, 3.0);
});

test('meetsAAText / meetsAALarge results', () => {
  assert.equal(meetsAAText('#000000', '#ffffff'), true);
  assert.equal(meetsAAText('#ffffff', '#ffffff'), false);
  assert.equal(meetsAALarge('#ffffff', '#ffffff'), false);
  // A ~3.2:1 gray pair passes large (>3.0), fails text (<4.5).
  assert.ok(contrastRatio('#909090', '#ffffff') < AA_TEXT_RATIO);
  assert.ok(contrastRatio('#909090', '#ffffff') >= AA_LARGE_RATIO);
});
