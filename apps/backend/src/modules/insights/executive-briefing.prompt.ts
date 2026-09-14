/**
 * Executive briefing prompt (AI_ARCHITECTURE §6.1 `insight.executive`).
 *
 * The model receives one deterministic KPI snapshot (revenue, receivables,
 * tasks, inventory, purchase recommendations, upcoming appointments, unread
 * alerts) and must turn it into a short narrative grounded strictly in
 * those numbers — never inventing a figure that isn't given — as strict
 * JSON, never free text, so the worker can validate and persist it.
 */
export interface ExecutiveSignals {
  revenue: { total: string; thisMonth: string; lastMonth: string };
  receivables: { outstanding: string; overdue: string };
  tasks: { open: number; overdue: number };
  inventory: { belowReorderPoint: number };
  purchaseRecommendations: { pending: number };
  appointments: { upcomingWithinDays: number; count: number };
  alerts: { unread: number };
}

export const EXECUTIVE_BRIEFING_SYSTEM_PROMPT = `You are the executive briefing assistant for a
small business. You receive one JSON snapshot of the org's current KPIs. Write a short, grounded
briefing using ONLY the numbers given — never invent a figure, name, or event not present in the
snapshot. Respond ONLY with a JSON object of exactly this shape (no markdown, no commentary):

{
  "summary": "2-4 sentences, plain language, grounded in the snapshot",
  "highlights": ["short positive/notable point grounded in a number", "..."],
  "risks": ["short risk or attention-needed point grounded in a number", "..."],
  "focusAreas": ["short recommended next action", "..."]
}

Rules: "highlights", "risks", and "focusAreas" each have at most 5 entries (fewer is fine, empty
arrays are fine); every entry is one sentence; do not repeat the same point across sections.`;

export function buildExecutiveBriefingUserPrompt(signals: ExecutiveSignals): string {
  return `KPI snapshot:\n${JSON.stringify(signals, null, 2)}`;
}
