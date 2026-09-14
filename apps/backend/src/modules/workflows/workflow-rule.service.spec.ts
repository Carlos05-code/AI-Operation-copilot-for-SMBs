/**
 * Unit tests — WorkflowRuleService (CRUD, validation delegation, sweep enqueue).
 */
import type { PrismaService } from '../database/prisma.service';
import type { QueueService } from '../queue/queue.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { WorkflowRuleService } from './workflow-rule.service';

function ruleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rule-1',
    organizationId: 'org-1',
    name: 'Notify on overdue',
    triggerEntity: 'INVOICE',
    conditions: [{ field: 'status', operator: 'eq', value: 'OVERDUE' }],
    actions: [{ type: 'SEND_NOTIFICATION', title: 'Invoice overdue', body: 'Invoice overdue' }],
    active: true,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    workflowRule: {
      create: jest.fn().mockResolvedValue(ruleRow()),
      findMany: jest.fn().mockResolvedValue([ruleRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(ruleRow()),
      update: jest.fn().mockResolvedValue(ruleRow({ active: false })),
    },
    workflowRun: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') };
  const service = new WorkflowRuleService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  );
  return { service, prisma, queue };
}

const baseInput = {
  organizationId: 'org-1',
  name: 'Notify on overdue',
  triggerEntity: 'INVOICE',
  conditions: [{ field: 'status', operator: 'eq', value: 'OVERDUE' }],
  actions: [{ type: 'SEND_NOTIFICATION', title: 'Invoice overdue' }],
};

describe('WorkflowRuleService.create', () => {
  it('validates conditions/actions against the trigger entity and persists', async () => {
    const { service, prisma } = harness();
    await service.create(baseInput);
    expect(prisma.workflowRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          triggerEntity: 'INVOICE',
          conditions: [{ field: 'status', operator: 'eq', value: 'OVERDUE' }],
        }),
      }),
    );
  });

  it('400s an unknown triggerEntity, an empty name, and an invalid condition', async () => {
    const { service } = harness();
    await expect(service.create({ ...baseInput, triggerEntity: 'CUSTOMER' })).rejects.toMatchObject(
      {
        code: HttpErrorCode.VALIDATION_ERROR,
        status: 400,
      },
    );
    await expect(service.create({ ...baseInput, name: '  ' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.create({ ...baseInput, conditions: [{ field: 'ghost', operator: 'eq', value: 1 }] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new WorkflowRuleService(undefined, undefined);
    await expect(service.create(baseInput)).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});

describe('WorkflowRuleService.list/get/listRuns', () => {
  it('lists org-scoped rules with an optional active filter', async () => {
    const { service, prisma } = harness();
    await service.list('org-1', 1, 20, true);
    expect(prisma.workflowRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', active: true } }),
    );
  });

  it('404s an unknown or foreign rule', async () => {
    const { service, prisma } = harness();
    prisma.workflowRule.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'rule-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('lists a rule’s run history, 404ing a foreign rule first', async () => {
    const { service, prisma } = harness();
    await service.listRuns('org-1', 'rule-1', 1, 20);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ruleId: 'rule-1' } }),
    );

    prisma.workflowRule.findFirst.mockResolvedValue(null);
    await expect(service.listRuns('org-2', 'rule-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('WorkflowRuleService.update', () => {
  it('revalidates conditions against the existing (immutable) triggerEntity', async () => {
    const { service, prisma } = harness();
    await service.update('org-1', 'rule-1', {
      conditions: [{ field: 'total', operator: 'gt', value: 100 }],
    });
    expect(prisma.workflowRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conditions: [{ field: 'total', operator: 'gt', value: 100 }],
        }),
      }),
    );
  });

  it('deactivates a rule', async () => {
    const { service, prisma } = harness();
    const view = await service.update('org-1', 'rule-1', { active: false });
    expect(prisma.workflowRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
    expect(view.active).toBe(false);
  });

  it('is a no-op update when the patch is empty', async () => {
    const { service, prisma } = harness();
    await service.update('org-1', 'rule-1', {});
    expect(prisma.workflowRule.update).not.toHaveBeenCalled();
  });
});

describe('WorkflowRuleService.requestSweep', () => {
  it('enqueues the sweep job on ops-jobs and swallows enqueue failures', async () => {
    const { service, queue } = harness();
    await service.requestSweep();
    expect(queue.enqueue).toHaveBeenCalledWith('ops-jobs', 'workflow.rules.sweep', {});
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.requestSweep()).resolves.toBeUndefined();
  });
});
