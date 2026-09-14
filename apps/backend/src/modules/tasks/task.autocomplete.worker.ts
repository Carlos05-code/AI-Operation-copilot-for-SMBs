/**
 * TaskAutoCompletionWorker: consumes `task.autocomplete.sweep` jobs on the
 * shared `ops-jobs` queue (ROADMAP Phase 4 — low-risk task auto-completion
 * with human-in-the-loop).
 *
 * Deterministic, no LLM: an AI-planned task (`agentMetadata.signalKey`, set
 * by `TaskPlanningWorker`) is auto-completed only when the system can
 * *verify* its underlying signal already resolved — the linked invoice
 * moved to `PAID`/`VOID`, or the linked product climbed back above its
 * reorder point. No judgment call is made; "low risk" means the real-world
 * resolution already happened elsewhere in the system, the sweep is just
 * catching the task record up to it.
 *
 * Human-in-the-loop: every auto-completion notifies the assignee (or every
 * OWNER/ADMIN/MANAGER of the org when unassigned) with the exact reason,
 * and `PATCH /tasks/:id` reopens it exactly like any other task — nothing
 * about the action is hidden or irreversible.
 *
 * Fail-soft: without a database the job is a no-op; a per-task error is
 * logged and the sweep continues (the guarded `updateMany` claim, same
 * pattern as the other periodic sweeps, means a concurrent run never
 * double-completes or double-notifies). Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { InvoiceStatus, NotificationKind, Role, TaskStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  EVENT_TASK_AUTOCOMPLETED,
  JOB_TASK_AUTOCOMPLETE_SWEEP,
  TASK_AUTOCOMPLETE_BATCH_SIZE,
} from './task.constants';

export interface TaskAutocompleteResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  completed: number;
  notified: number;
}

interface CandidateTask {
  id: string;
  organizationId: string;
  title: string;
  assigneeId: string | null;
  agentMetadata: unknown;
  signalKey: string;
}

interface InvoiceSignal {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
}

interface ProductSignal {
  id: string;
  name: string;
  sku: string;
  belowReorderPoint: boolean;
}

const OPEN_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];
const RESOLVED_INVOICE_STATUSES: InvoiceStatus[] = [InvoiceStatus.PAID, InvoiceStatus.VOID];
const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];

@Processor(QUEUE_OPS_JOBS)
export class TaskAutoCompletionWorker extends WorkerHost {
  private readonly logger = new Logger(TaskAutoCompletionWorker.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job): Promise<TaskAutocompleteResult> {
    if (job.name !== JOB_TASK_AUTOCOMPLETE_SWEEP) {
      return { ran: false, skipped: 'name mismatch', candidates: 0, completed: 0, notified: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('task autocomplete sweep skipped: db not configured');
      return { ran: false, skipped: 'not configured', candidates: 0, completed: 0, notified: 0 };
    }

    const prisma = this.prisma;
    const openTasks = await prisma.task.findMany({
      where: { status: { in: OPEN_STATUSES } },
      take: TASK_AUTOCOMPLETE_BATCH_SIZE,
      select: {
        id: true,
        organizationId: true,
        title: true,
        assigneeId: true,
        agentMetadata: true,
      },
    });
    const candidates: CandidateTask[] = [];
    for (const task of openTasks) {
      const signalKey = extractSignalKey(task.agentMetadata);
      if (signalKey) candidates.push({ ...task, signalKey });
    }
    if (candidates.length === 0) {
      return { ran: true, candidates: 0, completed: 0, notified: 0 };
    }

    const signalKeys = [...new Set(candidates.map((task) => task.signalKey))];
    const [invoices, products] = await Promise.all([
      prisma.invoice.findMany({
        where: { id: { in: signalKeys } },
        select: { id: true, invoiceNumber: true, status: true },
      }),
      prisma.product.findMany({
        where: { id: { in: signalKeys } },
        select: { id: true, name: true, sku: true, belowReorderPoint: true },
      }),
    ]);
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const productById = new Map(products.map((product) => [product.id, product]));

    const recipientsByOrg = new Map<string, string[]>();
    let completed = 0;
    let notified = 0;

    for (const task of candidates) {
      try {
        const resolution = resolveSignal(task.signalKey, invoiceById, productById);
        if (!resolution) continue;

        const recipients = await this.recipientsFor(task, recipientsByOrg);
        const claimed = await prisma.$transaction(async (tx) => {
          const flip = await tx.task.updateMany({
            where: { id: task.id, status: { in: OPEN_STATUSES } },
            data: { status: TaskStatus.DONE },
          });
          if (flip.count === 0) return false;
          await tx.task.update({
            where: { id: task.id },
            data: {
              agentMetadata: { ...asRecord(task.agentMetadata), autoCompletedReason: resolution },
            },
          });
          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((userId) => ({
                organizationId: task.organizationId,
                userId,
                kind: NotificationKind.IN_APP,
                title: `Task auto-completed: ${task.title}`,
                body: resolution,
                payload: { taskId: task.id, reason: resolution },
              })),
            });
          }
          return true;
        });
        if (!claimed) continue;
        completed += 1;
        notified += recipients.length;
        await this.emitAutocompleted(task.id, task.organizationId, resolution);
      } catch (error) {
        this.logger.error(`autocomplete failed for task ${task.id}: ${(error as Error)?.message}`);
      }
    }

    this.logger.log(
      `task autocomplete sweep: ${completed}/${candidates.length} completed, ${notified} notifications`,
    );
    return { ran: true, candidates: candidates.length, completed, notified };
  }

  private async recipientsFor(
    task: CandidateTask,
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    if (task.assigneeId) return [task.assigneeId];
    const cached = cache.get(task.organizationId);
    if (cached) return cached;
    const prisma = this.prisma!;
    const members = await prisma.member.findMany({
      where: { organizationId: task.organizationId, role: { in: ALERT_ROLES } },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((member) => member.userId))];
    cache.set(task.organizationId, ids);
    return ids;
  }

  private async emitAutocompleted(
    taskId: string,
    organizationId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'task',
        aggregateId: taskId,
        eventType: EVENT_TASK_AUTOCOMPLETED,
        payload: { organizationId, taskId, reason },
      });
    } catch (error) {
      this.logger.warn(`autocomplete outbox append skipped: ${(error as Error)?.message}`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractSignalKey(agentMetadata: unknown): string | null {
  const value = asRecord(agentMetadata).signalKey;
  return typeof value === 'string' ? value : null;
}

/** Verifies the task's underlying signal already resolved; `null` if not (yet). */
function resolveSignal(
  signalKey: string,
  invoiceById: Map<string, InvoiceSignal>,
  productById: Map<string, ProductSignal>,
): string | null {
  const invoice = invoiceById.get(signalKey);
  if (invoice) {
    return RESOLVED_INVOICE_STATUSES.includes(invoice.status)
      ? `Invoice ${invoice.invoiceNumber} is now ${invoice.status}`
      : null;
  }
  const product = productById.get(signalKey);
  if (product && !product.belowReorderPoint) {
    return `${product.name} (${product.sku}) is restocked above its reorder point`;
  }
  return null;
}
