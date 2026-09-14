/**
 * ExecutiveBriefingWorker: consumes `insight.executive.briefing` jobs on the
 * shared `ai-jobs` queue (ROADMAP Phase 4 — executive insights briefings,
 * AI_ARCHITECTURE §6.1 `insight.executive`).
 *
 * Pipeline: collect one deterministic KPI snapshot (revenue, receivables,
 * tasks, inventory, purchase recommendations, upcoming appointments, unread
 * alerts — the same figures `DashboardService` surfaces, plus a few more) →
 * run the `insight.executive.v1` prompt through the LLM → validate the JSON
 * briefing → persist an `ExecutiveBriefing` with the signal snapshot kept
 * for transparency → emit `insight.executive.generated`.
 *
 * Fail-soft: without a database or LLM config the job is a no-op; malformed
 * model output throws so BullMQ retries (one org per job, same contract as
 * `TaskPlanningWorker`); outbox failures are logged, not fatal.
 * Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import {
  AppointmentStatus,
  InvoiceStatus,
  PurchaseRecommendationStatus,
  TaskStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import {
  buildExecutiveBriefingUserPrompt,
  EXECUTIVE_BRIEFING_SYSTEM_PROMPT,
  type ExecutiveSignals,
} from './executive-briefing.prompt';
import {
  EVENT_EXECUTIVE_BRIEFING_GENERATED,
  EXECUTIVE_BRIEFING_APPOINTMENT_WINDOW_DAYS,
  EXECUTIVE_BRIEFING_MAX_TOKENS,
  EXECUTIVE_BRIEFING_PROMPT_VERSION,
  JOB_EXECUTIVE_BRIEFING,
} from './executive-briefing.constants';

export interface ExecutiveBriefingJobData {
  organizationId: string;
}

export interface ExecutiveBriefingResult {
  organizationId: string;
  generated: boolean;
  skipped?: string;
  briefingId?: string;
}

interface BriefingPayload {
  summary: string;
  highlights: string[];
  risks: string[];
  focusAreas: string[];
}

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];
const OPEN_RECEIVABLE_STATUSES: InvoiceStatus[] = [InvoiceStatus.SENT, InvoiceStatus.OVERDUE];
const HOLDING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];
const MAX_ENTRIES = 5;
const MAX_ENTRY_LENGTH = 300;

@Processor(QUEUE_AI_JOBS)
export class ExecutiveBriefingWorker extends WorkerHost {
  private readonly logger = new Logger(ExecutiveBriefingWorker.name);

  constructor(
    private readonly llm: LlmProvider,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<ExecutiveBriefingJobData>): Promise<ExecutiveBriefingResult> {
    if (job.name !== JOB_EXECUTIVE_BRIEFING) {
      return {
        organizationId: job.data.organizationId,
        generated: false,
        skipped: 'name mismatch',
      };
    }
    const { organizationId } = job.data;
    if (!this.prisma) {
      this.logger.warn(`executive briefing skipped for ${organizationId}: db not configured`);
      return { organizationId, generated: false, skipped: 'not configured' };
    }
    if (!this.llm.isConfigured) {
      this.logger.warn(`executive briefing skipped for ${organizationId}: llm not configured`);
      return { organizationId, generated: false, skipped: 'llm not configured' };
    }

    const signals = await this.collectSignals(organizationId);
    const content = await this.llm.complete(
      EXECUTIVE_BRIEFING_SYSTEM_PROMPT,
      buildExecutiveBriefingUserPrompt(signals),
      EXECUTIVE_BRIEFING_MAX_TOKENS,
    );
    const payload = parseBriefingPayload(content);
    if (!payload) {
      throw new Error('executive briefing model returned malformed JSON payload');
    }

    const briefing = await this.prisma.executiveBriefing.create({
      data: {
        organizationId,
        summary: payload.summary,
        highlights: payload.highlights,
        risks: payload.risks,
        focusAreas: payload.focusAreas,
        signals: { promptVersion: EXECUTIVE_BRIEFING_PROMPT_VERSION, ...signals },
      },
    });

    try {
      await this.outbox?.append({
        aggregateType: 'organization',
        aggregateId: organizationId,
        eventType: EVENT_EXECUTIVE_BRIEFING_GENERATED,
        payload: { organizationId, briefingId: briefing.id },
      });
    } catch (error) {
      this.logger.warn(`executive briefing outbox append skipped: ${(error as Error)?.message}`);
    }

    this.logger.log(`executive briefing generated for ${organizationId} (${briefing.id})`);
    return { organizationId, generated: true, briefingId: briefing.id };
  }

  private async collectSignals(organizationId: string): Promise<ExecutiveSignals> {
    const prisma = this.prisma!;
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(addMonths(now, -1));
    const appointmentWindowEnd = new Date(
      now.getTime() + EXECUTIVE_BRIEFING_APPOINTMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      revenueTotal,
      revenueThisMonth,
      revenueLastMonth,
      receivables,
      overdue,
      openTasks,
      overdueTasks,
      belowReorderPoint,
      pendingRecommendations,
      upcomingAppointments,
      unreadAlerts,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.PAID },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.PAID, createdAt: { gte: thisMonthStart } },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: {
          organizationId,
          status: InvoiceStatus.PAID,
          createdAt: { gte: lastMonthStart, lt: thisMonthStart },
        },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: { in: OPEN_RECEIVABLE_STATUSES } },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: InvoiceStatus.OVERDUE },
        _sum: { total: true },
      }),
      prisma.task.count({ where: { organizationId, status: { in: OPEN_TASK_STATUSES } } }),
      prisma.task.count({
        where: { organizationId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: now } },
      }),
      prisma.product.count({ where: { organizationId, active: true, belowReorderPoint: true } }),
      prisma.purchaseRecommendation.count({
        where: { organizationId, status: PurchaseRecommendationStatus.PENDING },
      }),
      prisma.appointment.count({
        where: {
          organizationId,
          status: { in: HOLDING_APPOINTMENT_STATUSES },
          startAt: { gte: now, lte: appointmentWindowEnd },
        },
      }),
      prisma.notification.count({ where: { organizationId, readAt: null } }),
    ]);

    return {
      revenue: {
        total: toMoney(revenueTotal._sum.total),
        thisMonth: toMoney(revenueThisMonth._sum.total),
        lastMonth: toMoney(revenueLastMonth._sum.total),
      },
      receivables: {
        outstanding: toMoney(receivables._sum.total),
        overdue: toMoney(overdue._sum.total),
      },
      tasks: { open: openTasks, overdue: overdueTasks },
      inventory: { belowReorderPoint },
      purchaseRecommendations: { pending: pendingRecommendations },
      appointments: {
        upcomingWithinDays: EXECUTIVE_BRIEFING_APPOINTMENT_WINDOW_DAYS,
        count: upcomingAppointments,
      },
      alerts: { unread: unreadAlerts },
    };
  }
}

function toMoney(
  value: { toFixed?: (digits?: number) => string } | number | null | undefined,
): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function parseBriefingPayload(content: string): BriefingPayload | null {
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<BriefingPayload>;
    if (typeof parsed.summary !== 'string' || parsed.summary.trim().length === 0) return null;
    const highlights = normalizeList(parsed.highlights);
    const risks = normalizeList(parsed.risks);
    const focusAreas = normalizeList(parsed.focusAreas);
    if (highlights === null || risks === null || focusAreas === null) return null;
    return {
      summary: parsed.summary.trim().slice(0, 1000),
      highlights,
      risks,
      focusAreas,
    };
  } catch {
    return null;
  }
}

function normalizeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return null;
    items.push(entry.trim().slice(0, MAX_ENTRY_LENGTH));
  }
  return items.slice(0, MAX_ENTRIES);
}
