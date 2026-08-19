/**
 * TaskPlanningWorker: consumes `task.plan` jobs on the shared `ai-jobs` queue
 * (ROADMAP Phase 3, AI_ARCHITECTURE §6.1, API_SPEC §11.11).
 *
 * Pipeline: collect deterministic business signals → run the `plan.tasks.v1`
 * prompt through the LLM → validate the JSON task plan → create tasks with
 * `agentMetadata` (prompt version, signal key, reason) → emit `task.planned`.
 *
 * Dedupe: an open task carrying the same `agentMetadata.signalKey` is never
 * duplicated across runs (jsonb path query). Fail-soft: without a database or
 * LLM config the job is skipped; malformed model output throws so BullMQ
 * retries; outbox failures are logged, not fatal. Non-matching job names are
 * skipped (the queue hosts multiple processors).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import type { TaskPriority } from '@prisma/client';
import { LlmProvider } from '../chat/llm.provider';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import {
  EVENT_TASK_PLANNED,
  JOB_TASK_PLAN,
  TASK_PLAN_MAX_SIGNALS,
  TASK_PLAN_MAX_TOKENS,
  TASK_PLAN_PROMPT_VERSION,
  TASK_PRIORITIES,
} from './task.constants';
import { TASK_PLAN_SYSTEM_PROMPT, buildPlanUserPrompt, type PlanningSignal } from './plan.prompt';

export interface TaskPlanJobData {
  organizationId: string;
}

export interface TaskPlanResult {
  organizationId: string;
  planned: boolean;
  skipped?: string;
  created: number;
  duplicates: number;
}

interface PlannedTask {
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string;
  reason?: string;
}

interface TaskPlanPayload {
  tasks: PlannedTask[];
}

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];

@Processor(QUEUE_AI_JOBS)
export class TaskPlanningWorker extends WorkerHost {
  private readonly logger = new Logger(TaskPlanningWorker.name);

  constructor(
    private readonly llm: LlmProvider,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<TaskPlanJobData>): Promise<TaskPlanResult> {
    if (job.name !== JOB_TASK_PLAN) {
      return {
        organizationId: job.data.organizationId,
        planned: false,
        skipped: 'name mismatch',
        created: 0,
        duplicates: 0,
      };
    }
    const { organizationId } = job.data;
    if (!this.prisma) {
      this.logger.warn(`task planning skipped for ${organizationId}: db not configured`);
      return {
        organizationId,
        planned: false,
        skipped: 'not configured',
        created: 0,
        duplicates: 0,
      };
    }

    const signals = await this.collectSignals(organizationId);
    if (signals.length === 0) {
      this.logger.log(`task planning skipped for ${organizationId}: no signals`);
      return { organizationId, planned: false, skipped: 'no signals', created: 0, duplicates: 0 };
    }
    if (!this.llm.isConfigured) {
      this.logger.warn(`task planning skipped for ${organizationId}: llm not configured`);
      return {
        organizationId,
        planned: false,
        skipped: 'llm not configured',
        created: 0,
        duplicates: 0,
      };
    }

    const content = await this.llm.complete(
      TASK_PLAN_SYSTEM_PROMPT,
      buildPlanUserPrompt(signals.slice(0, TASK_PLAN_MAX_SIGNALS)),
      TASK_PLAN_MAX_TOKENS,
    );
    const plan = parsePlanPayload(content);
    if (!plan) {
      throw new Error('planner returned malformed JSON payload');
    }

    let created = 0;
    let duplicates = 0;
    for (const task of plan.tasks) {
      const signalKey = task.reason ? findSignalKey(signals, task.reason) : undefined;
      const existing = signalKey
        ? await this.prisma.task.findFirst({
            where: {
              organizationId,
              status: { in: OPEN_TASK_STATUSES },
              agentMetadata: { path: ['signalKey'], equals: signalKey },
            },
            select: { id: true },
          })
        : null;
      if (existing) {
        duplicates += 1;
        continue;
      }
      await this.prisma.task.create({
        data: {
          organizationId,
          title: task.title,
          description: task.description ?? null,
          priority: task.priority,
          dueDate: task.dueDate ? new Date(task.dueDate) : null,
          agentMetadata: {
            promptVersion: TASK_PLAN_PROMPT_VERSION,
            ...(signalKey ? { signalKey } : {}),
            ...(task.reason ? { reason: task.reason } : {}),
          },
        },
      });
      created += 1;
    }

    try {
      await this.outbox?.append({
        aggregateType: 'task',
        aggregateId: organizationId,
        eventType: EVENT_TASK_PLANNED,
        payload: { organizationId, created, duplicates, signalCount: signals.length },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`planned ${created} tasks (${duplicates} duplicates) for ${organizationId}`);
    return { organizationId, planned: true, created, duplicates };
  }

  /**
   * Deterministic signal sources (stock convention: `sum(IN) - sum(OUT) +
   * sum(ADJUST)` per product — documented in DATABASE_SPEC §5).
   */
  private async collectSignals(organizationId: string): Promise<PlanningSignal[]> {
    const prisma = this.prisma!;
    const [overdueInvoices, products, stockSums] = await Promise.all([
      prisma.invoice.findMany({
        where: { organizationId, status: 'OVERDUE' },
        orderBy: { dueDate: 'asc' },
        take: 20,
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          dueDate: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.product.findMany({
        where: { organizationId, active: true, reorderPoint: { gt: 0 } },
        select: { id: true, name: true, sku: true, reorderPoint: true },
      }),
      prisma.inventoryMovement.groupBy({
        by: ['productId', 'type'],
        where: { product: { organizationId } },
        _sum: { quantity: true },
      }),
    ]);

    const signals: PlanningSignal[] = overdueInvoices.map((invoice) => ({
      type: 'overdue_invoice',
      id: invoice.id,
      line: `Invoice ${invoice.invoiceNumber} for ${invoice.customer.name} (${formatMoney(invoice.total)}) is overdue since ${invoice.dueDate.toISOString().slice(0, 10)}`,
    }));

    const stockByProduct = new Map<string, { IN: number; OUT: number; ADJUST: number }>();
    for (const row of stockSums) {
      const entry = stockByProduct.get(row.productId) ?? { IN: 0, OUT: 0, ADJUST: 0 };
      entry[row.type] += row._sum.quantity ?? 0;
      stockByProduct.set(row.productId, entry);
    }
    for (const product of products) {
      const stock = stockOf(stockByProduct.get(product.id));
      if (stock < (product.reorderPoint ?? 0)) {
        signals.push({
          type: 'low_stock',
          id: product.id,
          line: `${product.name} (${product.sku}) has ${stock} on hand, below reorder point ${product.reorderPoint}`,
        });
      }
    }

    return signals;
  }
}

function stockOf(movements: { IN: number; OUT: number; ADJUST: number } | undefined): number {
  if (!movements) return 0;
  return movements.IN - movements.OUT + movements.ADJUST;
}

function findSignalKey(signals: PlanningSignal[], reason: string): string | undefined {
  return signals.find((signal) => reason.includes(signal.id))?.id;
}

function formatMoney(value: { toFixed?: (digits?: number) => string } | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value?.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}

function parsePlanPayload(content: string): TaskPlanPayload | null {
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<TaskPlanPayload>;
    if (!Array.isArray(parsed.tasks)) return null;
    const tasks: PlannedTask[] = [];
    for (const raw of parsed.tasks) {
      const task = raw as Partial<PlannedTask>;
      if (typeof task.title !== 'string' || task.title.trim().length === 0) return null;
      if (!TASK_PRIORITIES.includes(task.priority as (typeof TASK_PRIORITIES)[number])) return null;
      if (task.dueDate !== undefined && Number.isNaN(new Date(task.dueDate).getTime())) return null;
      tasks.push({
        title: task.title.trim().slice(0, 255),
        description: task.description?.trim().slice(0, 4000) || undefined,
        priority: task.priority as TaskPriority,
        dueDate: task.dueDate,
        reason: task.reason?.trim(),
      });
    }
    return { tasks };
  } catch {
    return null;
  }
}
