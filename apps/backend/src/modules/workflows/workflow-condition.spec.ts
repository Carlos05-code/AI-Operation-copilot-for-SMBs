/**
 * Unit tests — pure rules-engine core (condition/action validation, evaluation).
 */
import {
  evaluateConditions,
  validateActions,
  validateConditions,
  type WorkflowCondition,
} from './workflow-condition';

describe('validateConditions', () => {
  it('accepts a valid condition set per entity field schema', () => {
    expect(
      validateConditions('PRODUCT', [{ field: 'belowReorderPoint', operator: 'eq', value: true }]),
    ).toEqual([{ field: 'belowReorderPoint', operator: 'eq', value: true }]);
    expect(
      validateConditions('INVOICE', [{ field: 'total', operator: 'gte', value: 500 }]),
    ).toEqual([{ field: 'total', operator: 'gte', value: 500 }]);
  });

  it('rejects an empty or oversized array', () => {
    expect(() => validateConditions('TASK', [])).toThrow('non-empty array');
    const tooMany = Array.from({ length: 11 }, () => ({
      field: 'status',
      operator: 'eq',
      value: 'TODO',
    }));
    expect(() => validateConditions('TASK', tooMany)).toThrow('cannot exceed');
  });

  it('rejects a field outside the entity allowlist', () => {
    expect(() =>
      validateConditions('APPOINTMENT', [{ field: 'total', operator: 'eq', value: 1 }]),
    ).toThrow(/field must be one of/);
  });

  it('rejects an operator not permitted for the field type', () => {
    expect(() =>
      validateConditions('PRODUCT', [{ field: 'belowReorderPoint', operator: 'gt', value: true }]),
    ).toThrow(/operator must be one of/);
  });

  it('rejects a value whose type does not match the field', () => {
    expect(() =>
      validateConditions('INVOICE', [{ field: 'total', operator: 'eq', value: '500' }]),
    ).toThrow(/value must be a number/);
  });
});

describe('validateActions', () => {
  it('accepts a CREATE_TASK action, defaulting priority to MEDIUM', () => {
    expect(validateActions([{ type: 'CREATE_TASK', title: 'Follow up' }])).toEqual([
      { type: 'CREATE_TASK', title: 'Follow up', description: undefined, priority: 'MEDIUM' },
    ]);
  });

  it('accepts a SEND_NOTIFICATION action, defaulting body to the title', () => {
    expect(validateActions([{ type: 'SEND_NOTIFICATION', title: 'Heads up' }])).toEqual([
      { type: 'SEND_NOTIFICATION', title: 'Heads up', body: 'Heads up' },
    ]);
  });

  it('rejects an unknown action type, a missing title, and an invalid priority', () => {
    expect(() => validateActions([{ type: 'DELETE_EVERYTHING', title: 'x' }])).toThrow(
      /type must be one of/,
    );
    expect(() => validateActions([{ type: 'CREATE_TASK', title: '' }])).toThrow(
      'title is required',
    );
    expect(() =>
      validateActions([{ type: 'CREATE_TASK', title: 'x', priority: 'CRITICAL' }]),
    ).toThrow(/priority must be one of/);
  });

  it('rejects an empty or oversized array', () => {
    expect(() => validateActions([])).toThrow('non-empty array');
    const tooMany = Array.from({ length: 6 }, () => ({ type: 'SEND_NOTIFICATION', title: 'x' }));
    expect(() => validateActions(tooMany)).toThrow('cannot exceed');
  });
});

describe('evaluateConditions', () => {
  it('requires every condition to hold (AND)', () => {
    const conditions: WorkflowCondition[] = [
      { field: 'belowReorderPoint', operator: 'eq', value: true },
      { field: 'reorderPoint', operator: 'gt', value: 10 },
    ];
    expect(evaluateConditions(conditions, { belowReorderPoint: true, reorderPoint: 20 })).toBe(
      true,
    );
    expect(evaluateConditions(conditions, { belowReorderPoint: true, reorderPoint: 5 })).toBe(
      false,
    );
    expect(evaluateConditions(conditions, { belowReorderPoint: false, reorderPoint: 20 })).toBe(
      false,
    );
  });

  it('evaluates every numeric operator correctly', () => {
    const at = (operator: WorkflowCondition['operator'], value: number) =>
      evaluateConditions([{ field: 'total', operator, value }], { total: 100 });
    expect(at('eq', 100)).toBe(true);
    expect(at('ne', 100)).toBe(false);
    expect(at('gt', 99)).toBe(true);
    expect(at('gte', 100)).toBe(true);
    expect(at('lt', 101)).toBe(true);
    expect(at('lte', 100)).toBe(true);
    expect(at('gt', 100)).toBe(false);
  });

  it('is false when the field is missing from the entity record', () => {
    expect(evaluateConditions([{ field: 'total', operator: 'eq', value: 100 }], {})).toBe(false);
  });
});
