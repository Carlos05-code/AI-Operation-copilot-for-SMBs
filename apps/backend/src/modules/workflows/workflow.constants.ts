/**
 * Workflow rules-engine constants (ROADMAP Phase 4 — visual workflow
 * builder / rules engine, stretch).
 */
export const JOB_WORKFLOW_RULES_SWEEP = 'workflow.rules.sweep';
export const EVENT_WORKFLOW_RULE_FIRED = 'workflow.rule_fired';

export const WORKFLOW_RULE_NAME_MAX_LENGTH = 255;
export const WORKFLOW_MAX_CONDITIONS = 10;
export const WORKFLOW_MAX_ACTIONS = 5;

/** Bounds on one sweep run. */
export const WORKFLOW_RULE_BATCH_SIZE = 500;
export const WORKFLOW_ENTITY_BATCH_SIZE = 500;

export const WORKFLOW_TRIGGER_ENTITIES = ['INVOICE', 'PRODUCT', 'TASK', 'APPOINTMENT'] as const;
export const WORKFLOW_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;
export const WORKFLOW_ACTION_TYPES = ['CREATE_TASK', 'SEND_NOTIFICATION'] as const;
