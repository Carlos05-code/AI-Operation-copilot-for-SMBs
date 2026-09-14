/**
 * AI task planning constants (ROADMAP Phase 3, API_SPEC §11.11; Phase 4 —
 * low-risk task auto-completion).
 */
export const JOB_TASK_PLAN = 'task.plan';
export const EVENT_TASK_PLANNED = 'task.planned';
export const TASK_PLAN_PROMPT_VERSION = 'plan.tasks.v1';

/** Max signal lines fed to the planner per run. */
export const TASK_PLAN_MAX_SIGNALS = 40;
export const TASK_PLAN_MAX_TOKENS = 500;

/** BullMQ job name on the shared `ops-jobs` queue (deterministic — no LLM). */
export const JOB_TASK_AUTOCOMPLETE_SWEEP = 'task.autocomplete.sweep';
export const EVENT_TASK_AUTOCOMPLETED = 'task.autocompleted';

/** Batch size for the periodic auto-completion sweep. */
export const TASK_AUTOCOMPLETE_BATCH_SIZE = 200;

export const TASK_TITLE_MAX_LENGTH = 255;
export const TASK_DESCRIPTION_MAX_LENGTH = 4000;
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
