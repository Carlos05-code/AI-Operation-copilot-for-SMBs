/**
 * Token integrity tests: consistency with DESIGN_SYSTEM.md, the 4px spacing
 * grid, dark/light symmetry, and valid hex values.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { colors, tokenPairs } from '../src/tokens/colors.js';
import { typography } from '../src/tokens/typography.js';
import { spacing } from '../src/tokens/spacing.js';
import { radii } from '../src/tokens/radii.js';
import { breakpoints } from '../src/tokens/breakpoints.js';

const HEX = /^#[0-9a-f]{6}$/i;

test('every color token is a valid hex pair (light + dark)', () => {
  for (const [name, { light, dark }] of Object.entries(colors)) {
    assert.match(light, HEX, `${name}.light`);
    assert.match(dark, HEX, `${name}.dark`);
  }
});

test('tokenPairs reference only declared tokens', () => {
  const names = Object.keys(colors);
  for (const [fg, bg] of tokenPairs) {
    assert.ok(names.includes(fg), `foreground "${fg}"`);
    assert.ok(names.includes(bg), `background "${bg}"`);
  }
});

test('spacing follows the 4px grid', () => {
  for (const [name, value] of Object.entries(spacing)) {
    assert.equal(value % 4, 0, `${name}=${value} not on 4px grid`);
  }
});

test('spacing scale matches DESIGN_SYSTEM §5', () => {
  assert.deepEqual(spacing, {
    space1: 4,
    space2: 8,
    space3: 12,
    space4: 16,
    space5: 20,
    space6: 24,
    space8: 32,
    space10: 40,
    space12: 48,
  });
});

test('radii match DESIGN_SYSTEM §4', () => {
  assert.deepEqual(radii, { none: 0, sm: 4, md: 8, lg: 12, circle: '50%' });
});

test('typography roles carry a valid weight', () => {
  const weights = [400, 500, 600, 700];
  for (const [name, t] of Object.entries(typography)) {
    assert.ok(t.fontSizePx > 0, `${name}.fontSizePx`);
    assert.ok(t.lineHeight > 0, `${name}.lineHeight`);
    const weight = t.fontWeight as (typeof weights)[number];
    assert.ok(weights.includes(weight), `${name}.fontWeight`);
  }
});

test('breakpoints are continuous and ordered', () => {
  assert.ok(breakpoints.compact.max < (breakpoints.medium.min as number));
  assert.ok((breakpoints.medium.max as number) < breakpoints.expanded.min);
});
