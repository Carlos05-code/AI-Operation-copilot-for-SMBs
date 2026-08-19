/**
 * Task planning prompts (AI_ARCHITECTURE §6.1 `plan.tasks`).
 *
 * The model receives a bounded list of deterministic business signals
 * (overdue invoices, low-stock products) and must return a strict JSON task
 * plan — never free text — so the worker can validate and persist it.
 */
import { TASK_PLAN_MAX_SIGNALS, TASK_PRIORITIES } from './task.constants';

export const TASK_PLAN_SYSTEM_PROMPT = `You are the operations planner for a small business. Convert
the business signals below into a concrete task plan for the owner or an agent. Each task must be
actionable, specific, and grounded in the signals. Respond ONLY with a JSON object of exactly this
shape (no markdown, no commentary):

{
  "tasks": [
    {
      "title": "short imperative title",
      "description": "one or two sentences of context (what and why)",
      "priority": "LOW | MEDIUM | HIGH | URGENT",
      "dueDate": "ISO-8601 date, or omit when no deadline is implied",
      "reason": "which signal motivated this task"
    }
  ]
}

Rules: no more than ${TASK_PLAN_MAX_SIGNALS} tasks; priorities only from
${TASK_PRIORITIES.join(', ')}; dueDate must be a valid ISO-8601 date.`;

export interface PlanningSignal {
  type: 'overdue_invoice' | 'low_stock';
  id: string;
  line: string;
}

export function buildPlanUserPrompt(signals: PlanningSignal[]): string {
  const lines = signals.map((signal) => `- [${signal.type}] ${signal.line}`);
  return `Business signals:\n${lines.join('\n')}`;
}
