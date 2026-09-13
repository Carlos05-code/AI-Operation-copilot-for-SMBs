/**
 * Pure stock-ledger helpers (no I/O). On-hand convention (DATABASE_SPEC §5,
 * shared with the AI task planner's low-stock signal):
 *
 *   on-hand = sum(IN) − sum(OUT) + sum(ADJUST)
 *
 * `IN`/`OUT` quantities are recorded positive (direction comes from `type`);
 * `ADJUST` carries its own sign so a stocktake correction can move stock
 * either way.
 */
import type { MovementType } from '@prisma/client';

export interface MovementSum {
  productId: string;
  type: MovementType;
  _sum: { quantity: number | null };
}

/** Reduces grouped movement sums (one row per product × type) to on-hand per product. */
export function computeStockMap(rows: readonly MovementSum[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const row of rows) {
    const quantity = row._sum.quantity ?? 0;
    const delta = row.type === 'OUT' ? -quantity : quantity;
    stock.set(row.productId, (stock.get(row.productId) ?? 0) + delta);
  }
  return stock;
}

/** Whether a product should be flagged low-stock (untracked when reorderPoint is 0/unset). */
export function isBelowReorderPoint(onHand: number, reorderPoint: number | null): boolean {
  return Boolean(reorderPoint && reorderPoint > 0 && onHand < reorderPoint);
}
