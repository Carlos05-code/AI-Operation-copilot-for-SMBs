/**
 * WorkflowRuleService: org-scoped CRUD over workflow rules + sweep
 * scheduling (ROADMAP Phase 4 — visual workflow builder / rules engine,
 * stretch).
 *
 * `requestSweep` enqueues a `workflow.rules.sweep` job on the shared
 * `ops-jobs` queue (fire-and-forget, fail-soft, org-wide — mirrors
 * `/invoices/sweep-overdue`). `triggerEntity` is immutable once a rule is
 * created (changing it would make its `WorkflowRun` history mean something
 * else); `name`/`conditions`/`actions`/`active` can all be updated.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, WorkflowTriggerEntity } from '@prisma/client';
import type { WorkflowRule, WorkflowRun } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { validateActions, validateConditions } from './workflow-condition';
import {
  JOB_WORKFLOW_RULES_SWEEP,
  WORKFLOW_RULE_NAME_MAX_LENGTH,
  WORKFLOW_TRIGGER_ENTITIES,
} from './workflow.constants';

export interface CreateWorkflowRuleInput {
  organizationId: string;
  name: string;
  triggerEntity: string;
  conditions: unknown;
  actions: unknown;
}

export interface UpdateWorkflowRuleInput {
  name?: string;
  conditions?: unknown;
  actions?: unknown;
  active?: boolean;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

@Injectable()
export class WorkflowRuleService {
  private readonly logger = new Logger(WorkflowRuleService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  async create(input: CreateWorkflowRuleInput): Promise<WorkflowRule> {
    const prisma = this.requirePrisma();
    const name = requireName(input.name);
    const triggerEntity = requireTriggerEntity(input.triggerEntity);
    const conditions = validateConditions(triggerEntity, input.conditions);
    const actions = validateActions(input.actions);
    return prisma.workflowRule.create({
      data: {
        organizationId: input.organizationId,
        name,
        triggerEntity,
        conditions: conditions as unknown as Prisma.InputJsonValue,
        actions: actions as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    active?: boolean,
  ): Promise<ListResult<WorkflowRule>> {
    const prisma = this.requirePrisma();
    const where: Prisma.WorkflowRuleWhereInput = {
      organizationId,
      ...(active !== undefined ? { active } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.workflowRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workflowRule.count({ where }),
    ]);
    return { items, total };
  }

  async get(organizationId: string, id: string): Promise<WorkflowRule> {
    return this.load(organizationId, id);
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateWorkflowRuleInput,
  ): Promise<WorkflowRule> {
    const prisma = this.requirePrisma();
    const existing = await this.load(organizationId, id);
    const data: Prisma.WorkflowRuleUpdateInput = {};
    if (patch.name !== undefined) data.name = requireName(patch.name);
    if (patch.conditions !== undefined) {
      data.conditions = validateConditions(
        existing.triggerEntity,
        patch.conditions,
      ) as unknown as Prisma.InputJsonValue;
    }
    if (patch.actions !== undefined) {
      data.actions = validateActions(patch.actions) as unknown as Prisma.InputJsonValue;
    }
    if (patch.active !== undefined) data.active = patch.active;
    if (Object.keys(data).length === 0) return existing;
    return prisma.workflowRule.update({ where: { id: existing.id }, data });
  }

  async listRuns(
    organizationId: string,
    id: string,
    page = 1,
    limit = 20,
  ): Promise<ListResult<WorkflowRun>> {
    const prisma = this.requirePrisma();
    await this.load(organizationId, id);
    const where = { ruleId: id };
    const [items, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workflowRun.count({ where }),
    ]);
    return { items, total };
  }

  /** Schedules the org-wide rules sweep (fire-and-forget). */
  async requestSweep(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue(QUEUE_OPS_JOBS, JOB_WORKFLOW_RULES_SWEEP, {});
    } catch (error) {
      this.logger.warn(`workflow rules sweep enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private async load(organizationId: string, id: string): Promise<WorkflowRule> {
    const prisma = this.requirePrisma();
    const rule = await prisma.workflowRule.findFirst({ where: { id, organizationId } });
    if (!rule) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Workflow rule not found',
      });
    }
    return rule;
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}

function requireName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: "'name' is required",
    });
  }
  if (trimmed.length > WORKFLOW_RULE_NAME_MAX_LENGTH) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'name' exceeds ${WORKFLOW_RULE_NAME_MAX_LENGTH} characters`,
    });
  }
  return trimmed;
}

function requireTriggerEntity(value: string): WorkflowTriggerEntity {
  if (!WORKFLOW_TRIGGER_ENTITIES.includes(value as (typeof WORKFLOW_TRIGGER_ENTITIES)[number])) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'triggerEntity' must be one of: ${WORKFLOW_TRIGGER_ENTITIES.join(', ')}`,
    });
  }
  return value as WorkflowTriggerEntity;
}
