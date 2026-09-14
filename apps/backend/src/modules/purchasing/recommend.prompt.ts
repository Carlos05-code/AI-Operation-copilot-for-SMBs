/**
 * Purchase recommendation prompt (AI_ARCHITECTURE §6.1 `recommend.reorder`).
 *
 * The model receives one deterministic signal line per product already below
 * its reorder point — on-hand, reorder point, and trailing 30-day
 * consumption — and must return a strict JSON list of quantity + reasoning
 * per product, never free text, so the worker can validate and persist it.
 */
import { PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG } from './purchase-recommendation.constants';

export const PURCHASE_RECOMMEND_SYSTEM_PROMPT = `You are the purchasing assistant for a small
business. Each line below is a product already below its reorder point, with how much stock it
has on hand, its reorder point, and how many units it sold or used over the trailing 30 days.
Decide how many units to reorder for each product and why. Favor enough stock to cover roughly
30 days of trailing consumption plus the reorder point buffer; if there is no consumption history,
recommend enough to clear the reorder point with a small safety margin. Respond ONLY with a JSON
object of exactly this shape (no markdown, no commentary):

{
  "recommendations": [
    {
      "productId": "the exact id from the signal line",
      "quantity": 0,
      "reason": "one sentence grounded in the on-hand, reorder point, and consumption figures"
    }
  ]
}

Rules: no more than ${PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG} recommendations; "quantity" must be a
positive integer; only use "productId" values that appear in the signal lines below.`;

export interface PurchaseRecommendSignal {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
  consumedLast30Days: number;
}

export function buildPurchaseRecommendUserPrompt(signals: PurchaseRecommendSignal[]): string {
  const lines = signals.map(
    (signal) =>
      `- id=${signal.productId} ${signal.name} (${signal.sku}): ${signal.onHand} on hand, reorder point ${signal.reorderPoint}, consumed ${signal.consumedLast30Days} in the last 30 days`,
  );
  return `Products below their reorder point:\n${lines.join('\n')}`;
}
