/**
 * Pure rules-engine core (no I/O): the field/operator registry, condition
 * validation + evaluation, and action validation (ROADMAP Phase 4 — visual
 * workflow builder / rules engine, stretch).
 *
 * Deliberately small and transparent — no expression language, no nested
 * AND/OR groups: a rule is a flat list of conditions (all must hold) against
 * an explicit per-entity field allowlist, and a flat list of actions from a
 * fixed, safe catalog. A future visual builder targets this exact shape
 * (one node per condition/action).
 */
import type { TaskPriority, WorkflowTriggerEntity } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
} from '../tasks/task.constants';
import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_MAX_ACTIONS,
  WORKFLOW_MAX_CONDITIONS,
  WORKFLOW_OPERATORS,
} from './workflow.constants';

export type WorkflowOperator = (typeof WORKFLOW_OPERATORS)[number];
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export interface WorkflowCondition {
  field: string;
  operator: WorkflowOperator;
  value: string | number | boolean;
}

export interface CreateTaskAction {
  type: 'CREATE_TASK';
  title: string;
  description?: string;
  priority: TaskPriority;
}

export interface SendNotificationAction {
  type: 'SEND_NOTIFICATION';
  title: string;
  body: string;
}

export type WorkflowAction = CreateTaskAction | SendNotificationAction;

type FieldType = 'string' | 'number' | 'boolean';
interface FieldDef {
  type: FieldType;
  operators: readonly WorkflowOperator[];
}

const EQUALITY_ONLY: readonly WorkflowOperator[] = ['eq', 'ne'];

/** Explicit per-entity allowlist — the only fields a rule may ever reference. */
export const WORKFLOW_FIELD_SCHEMA: Record<WorkflowTriggerEntity, Record<string, FieldDef>> = {
  INVOICE: {
    status: { type: 'string', operators: EQUALITY_ONLY },
    total: { type: 'number', operators: WORKFLOW_OPERATORS },
  },
  PRODUCT: {
    belowReorderPoint: { type: 'boolean', operators: EQUALITY_ONLY },
    reorderPoint: { type: 'number', operators: WORKFLOW_OPERATORS },
  },
  TASK: {
    status: { type: 'string', operators: EQUALITY_ONLY },
    priority: { type: 'string', operators: EQUALITY_ONLY },
  },
  APPOINTMENT: {
    status: { type: 'string', operators: EQUALITY_ONLY },
  },
};

function invalid(message: string): never {
  throw new ApiError({ code: HttpErrorCode.VALIDATION_ERROR, status: 400, message });
}

/** Validates a raw conditions payload against the entity's field schema. Throws 400 on any problem. */
export function validateConditions(
  triggerEntity: WorkflowTriggerEntity,
  raw: unknown,
): WorkflowCondition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    invalid("'conditions' must be a non-empty array");
  }
  if (raw.length > WORKFLOW_MAX_CONDITIONS) {
    invalid(`'conditions' cannot exceed ${WORKFLOW_MAX_CONDITIONS} entries`);
  }
  const schema = WORKFLOW_FIELD_SCHEMA[triggerEntity];
  return raw.map((entry, index) => {
    const label = `conditions[${index}]`;
    const condition = entry as Partial<WorkflowCondition>;
    const fieldDef = typeof condition.field === 'string' ? schema[condition.field] : undefined;
    if (!fieldDef) {
      invalid(
        `${label}.field must be one of: ${Object.keys(schema).join(', ')} (for ${triggerEntity})`,
      );
    }
    if (!fieldDef.operators.includes(condition.operator as WorkflowOperator)) {
      invalid(`${label}.operator must be one of: ${fieldDef.operators.join(', ')}`);
    }
    if (typeof condition.value !== fieldDef.type) {
      invalid(`${label}.value must be a ${fieldDef.type}`);
    }
    return {
      field: condition.field as string,
      operator: condition.operator as WorkflowOperator,
      value: condition.value as string | number | boolean,
    };
  });
}

/** Validates a raw actions payload against the fixed action catalog. Throws 400 on any problem. */
export function validateActions(raw: unknown): WorkflowAction[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    invalid("'actions' must be a non-empty array");
  }
  if (raw.length > WORKFLOW_MAX_ACTIONS) {
    invalid(`'actions' cannot exceed ${WORKFLOW_MAX_ACTIONS} entries`);
  }
  return raw.map((entry, index) => {
    const label = `actions[${index}]`;
    const action = entry as Partial<WorkflowAction>;
    if (!WORKFLOW_ACTION_TYPES.includes(action.type as WorkflowActionType)) {
      invalid(`${label}.type must be one of: ${WORKFLOW_ACTION_TYPES.join(', ')}`);
    }
    if (typeof action.title !== 'string' || action.title.trim().length === 0) {
      invalid(`${label}.title is required`);
    }
    if (action.title.length > TASK_TITLE_MAX_LENGTH) {
      invalid(`${label}.title exceeds ${TASK_TITLE_MAX_LENGTH} characters`);
    }
    if (action.type === 'CREATE_TASK') {
      const createTask = action;
      const priority = createTask.priority ?? 'MEDIUM';
      if (!TASK_PRIORITIES.includes(priority)) {
        invalid(`${label}.priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
      }
      if (
        createTask.description !== undefined &&
        createTask.description.length > TASK_DESCRIPTION_MAX_LENGTH
      ) {
        invalid(`${label}.description exceeds ${TASK_DESCRIPTION_MAX_LENGTH} characters`);
      }
      return {
        type: 'CREATE_TASK',
        title: createTask.title!.trim(),
        description: createTask.description?.trim() || undefined,
        priority,
      };
    }
    const sendNotification = action as Partial<SendNotificationAction>;
    return {
      type: 'SEND_NOTIFICATION',
      title: sendNotification.title!.trim(),
      body: sendNotification.body?.trim() || sendNotification.title!.trim(),
    };
  });
}

/** All conditions must hold (AND) against the given entity's field values. */
export function evaluateConditions(
  conditions: readonly WorkflowCondition[],
  entity: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => {
    const actual = entity[condition.field];
    switch (condition.operator) {
      case 'eq':
        return actual === condition.value;
      case 'ne':
        return actual !== condition.value;
      case 'gt':
        return typeof actual === 'number' && actual > (condition.value as number);
      case 'gte':
        return typeof actual === 'number' && actual >= (condition.value as number);
      case 'lt':
        return typeof actual === 'number' && actual < (condition.value as number);
      case 'lte':
        return typeof actual === 'number' && actual <= (condition.value as number);
      default:
        return false;
    }
  });
}
