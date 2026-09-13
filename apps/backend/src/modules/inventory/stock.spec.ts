/**
 * Unit tests — stock ledger helpers (pure).
 */
import { computeStockMap, isBelowReorderPoint } from './stock';

describe('computeStockMap', () => {
  it('applies IN and ADJUST additively, OUT subtractively', () => {
    const map = computeStockMap([
      { productId: 'p1', type: 'IN', _sum: { quantity: 50 } },
      { productId: 'p1', type: 'OUT', _sum: { quantity: 20 } },
      { productId: 'p1', type: 'ADJUST', _sum: { quantity: -3 } },
      { productId: 'p2', type: 'IN', _sum: { quantity: 6 } },
    ]);
    expect(map.get('p1')).toBe(27);
    expect(map.get('p2')).toBe(6);
  });

  it('treats a null sum as zero', () => {
    const map = computeStockMap([{ productId: 'p1', type: 'IN', _sum: { quantity: null } }]);
    expect(map.get('p1')).toBe(0);
  });

  it('returns an empty map for no rows', () => {
    expect(computeStockMap([]).size).toBe(0);
  });
});

describe('isBelowReorderPoint', () => {
  it('flags stock strictly under a positive reorder point', () => {
    expect(isBelowReorderPoint(4, 5)).toBe(true);
    expect(isBelowReorderPoint(5, 5)).toBe(false);
    expect(isBelowReorderPoint(6, 5)).toBe(false);
  });

  it('never flags when reorder tracking is off (0/null)', () => {
    expect(isBelowReorderPoint(0, 0)).toBe(false);
    expect(isBelowReorderPoint(-1, null)).toBe(false);
  });

  it('flags negative on-hand under a tracked reorder point', () => {
    expect(isBelowReorderPoint(-2, 5)).toBe(true);
  });
});
