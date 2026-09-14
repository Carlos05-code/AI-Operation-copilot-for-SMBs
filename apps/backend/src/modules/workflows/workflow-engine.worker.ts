/**
 * WorkflowEngineWorker: consumes `workflow.rules.sweep` jobs on the shared
 * `ops-jobs` queue (ROADMAP Phase 4 — visual workflow builder / rules
 * engine, stretch).
 *
 * Deterministic, no LLM: loads every active `WorkflowRule` across all
 * orgs, groups by (organizationId, triggerEntity), fetches that org's
 * current entities of the trigger type, and evaluates each rule's
 * conditions against each entity (`workflow-condition.ts`). A match runs
 * the rule's actions (`CREATE_TASK` / `SEND_NOTIFICATION` — real, safe,
 * already-existing operations) and records a `WorkflowRun`.
 *
 * Fires once per entity, ever: `WorkflowRun` is unique on
 * `(ruleId, entityId)`, checked before acting and written inside the same
 * transaction as the actions — a rule never re-fires on an entity it has
 * already matched, and the run is a full audit trail of what fired and
 * when. Fail-soft: without a database the job is a no-op; a per-rule/
 * per-entity failure is logged and the sweep continues. Non-matching job
 * names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { NotificationKind, Role, WorkflowTriggerEntity } from '@prisma/client';
import type { WorkflowRule } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  evaluateConditions,
  type WorkflowAction,
  type WorkflowCondition,
} from './workflow-condition';
import {
  EVENT_WORKFLOW_RULE_FIRED,
  JOB_WORKFLOW_RULES_SWEEP,
  WORKFLOW_ENTITY_BATCH_SIZE,
  WORKFLOW_RULE_BATCH_SIZE,
} from './workflow.constants';

export interface WorkflowSweepResult {
  ran: boolean;
  skipped?: string;
  rules: number;
  evaluated: number;
  fired: number;
}

interface WorkflowEntity {
  id: string;
  record: Record<string, unknown>;
}

const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];

@Processor(QUEUE_OPS_JOBS)
export class WorkflowEngineWorker extends WorkerHost {
  private readonly logger = new Logger(WorkflowEngineWorker.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job): Promise<WorkflowSweepResult> {
    if (job.name !== JOB_WORKFLOW_RULES_SWEEP) {
      return { ran: false, skipped: 'name mismatch', rules: 0, evaluated: 0, fired: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('workflow rules sweep skipped: db not configured');
      return { ran: false, skipped: 'not configured', rules: 0, evaluated: 0, fired: 0 };
    }

    const prisma = this.prisma;
    const rules = await prisma.workflowRule.findMany({
      where: { active: true },
      take: WORKFLOW_RULE_BATCH_SIZE,
    });
    if (rules.length === 0) {
      return { ran: true, rules: 0, evaluated: 0, fired: 0 };
    }

    const rulesByOrg = new Map<string, WorkflowRule[]>();
    for (const rule of rules) {
      const list = rulesByOrg.get(rule.organizationId) ?? [];
      list.push(rule);
      rulesByOrg.set(rule.organizationId, list);
    }

    const recipientsByOrg = new Map<string, string[]>();
    let evaluated = 0;
    let fired = 0;

    for (const [organizationId, orgRules] of rulesByOrg) {
      const rulesByEntity = new Map<WorkflowTriggerEntity, WorkflowRule[]>();
      for (const rule of orgRules) {
        const list = rulesByEntity.get(rule.triggerEntity) ?? [];
        list.push(rule);
        rulesByEntity.set(rule.triggerEntity, list);
      }

      for (const [triggerEntity, entityRules] of rulesByEntity) {
        const entities = await this.fetchEntities(organizationId, triggerEntity);
        for (const rule of entityRules) {
          for (const entity of entities) {
            evaluated += 1;
            try {
              const matched = evaluateConditions(
                rule.conditions as unknown as WorkflowCondition[],
                entity.record,
              );
              if (!matched) continue;

              const alreadyFired = await prisma.workflowRun.findFirst({
                where: { ruleId: rule.id, entityId: entity.id },
                select: { id: true },
              });
              if (alreadyFired) continue;

              await this.fire(rule, organizationId, entity.id, recipientsByOrg);
              fired += 1;
            } catch (error) {
              this.logger.error(
                `workflow rule ${rule.id} failed on ${triggerEntity} ${entity.id}: ${(error as Error)?.message}`,
              );
            }
          }
        }
      }
    }

    this.logger.log(
      `workflow rules sweep: ${fired} fired across ${evaluated} evaluations, ${rules.length} active rules`,
    );
    return { ran: true, rules: rules.length, evaluated, fired };
  }

  private async fire(
    rule: WorkflowRule,
    organizationId: string,
    entityId: string,
    recipientsByOrg: Map<string, string[]>,
  ): Promise<void> {
    const prisma = this.prisma!;
    const actions = rule.actions as unknown as WorkflowAction[];
    const executed: Array<{ type: string; title: string; recipients?: number }> = [];

    await prisma.$transaction(async (tx) => {
      await tx.workflowRun.create({ data: { ruleId: rule.id, entityId, actionsRun: [] } });
      for (const action of actions) {
        if (action.type === 'CREATE_TASK') {
          await tx.task.create({
            data: {
              organizationId,
              title: action.title,
              description: action.description ?? null,
              priority: action.priority,
              agentMetadata: { workflowRuleId: rule.id, entityId },
            },
          });
          executed.push({ type: action.type, title: action.title });
        } else {
          const recipients = await this.recipientsFor(organizationId, recipientsByOrg);
          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((userId) => ({
                organizationId,
                userId,
                kind: NotificationKind.IN_APP,
                title: action.title,
                body: action.body,
                payload: { workflowRuleId: rule.id, entityId },
              })),
            });
          }
          executed.push({ type: action.type, title: action.title, recipients: recipients.length });
        }
      }
      await tx.workflowRun.update({
        where: { ruleId_entityId: { ruleId: rule.id, entityId } },
        data: { actionsRun: executed },
      });
    });

    await this.emitFired(rule.id, organizationId, entityId, executed.length);
  }

  private async fetchEntities(
    organizationId: string,
    triggerEntity: WorkflowTriggerEntity,
  ): Promise<WorkflowEntity[]> {
    const prisma = this.prisma!;
    switch (triggerEntity) {
      case WorkflowTriggerEntity.INVOICE: {
        const rows = await prisma.invoice.findMany({
          where: { organizationId },
          take: WORKFLOW_ENTITY_BATCH_SIZE,
          select: { id: true, status: true, total: true },
        });
        return rows.map((row) => ({
          id: row.id,
          record: { status: row.status, total: toNumber(row.total) },
        }));
      }
      case WorkflowTriggerEntity.PRODUCT: {
        const rows = await prisma.product.findMany({
          where: { organizationId },
          take: WORKFLOW_ENTITY_BATCH_SIZE,
          select: { id: true, belowReorderPoint: true, reorderPoint: true },
        });
        return rows.map((row) => ({
          id: row.id,
          record: { belowReorderPoint: row.belowReorderPoint, reorderPoint: row.reorderPoint ?? 0 },
        }));
      }
      case WorkflowTriggerEntity.TASK: {
        const rows = await prisma.task.findMany({
          where: { organizationId },
          take: WORKFLOW_ENTITY_BATCH_SIZE,
          select: { id: true, status: true, priority: true },
        });
        return rows.map((row) => ({
          id: row.id,
          record: { status: row.status, priority: row.priority },
        }));
      }
      case WorkflowTriggerEntity.APPOINTMENT: {
        const rows = await prisma.appointment.findMany({
          where: { organizationId },
          take: WORKFLOW_ENTITY_BATCH_SIZE,
          select: { id: true, status: true },
        });
        return rows.map((row) => ({ id: row.id, record: { status: row.status } }));
      }
      default:
        return [];
    }
  }

  private async recipientsFor(
    organizationId: string,
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    const cached = cache.get(organizationId);
    if (cached) return cached;
    const prisma = this.prisma!;
    const members = await prisma.member.findMany({
      where: { organizationId, role: { in: ALERT_ROLES } },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((member) => member.userId))];
    cache.set(organizationId, ids);
    return ids;
  }

  private async emitFired(
    ruleId: string,
    organizationId: string,
    entityId: string,
    actionCount: number,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'workflow_rule',
        aggregateId: ruleId,
        eventType: EVENT_WORKFLOW_RULE_FIRED,
        payload: { organizationId, ruleId, entityId, actionCount },
      });
    } catch (error) {
      this.logger.warn(`workflow rule fired outbox append skipped: ${(error as Error)?.message}`);
    }
  }
}

function toNumber(value: { toFixed?: (digits?: number) => string } | number | null): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toFixed === 'function') return Number(value.toFixed(2));
  return 0;
}
