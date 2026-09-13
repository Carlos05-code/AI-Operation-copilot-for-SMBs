/**
 * AppointmentReminderWorker: consumes `appointment.reminder.sweep` jobs on
 * the `ops-jobs` queue (ROADMAP Phase 3 — appointment scheduling).
 *
 * Finds `SCHEDULED`/`CONFIRMED` appointments starting within
 * `REMINDER_WINDOW_HOURS` that haven't been reminded yet, and raises one
 * in-app `Notification` each — to the assigned staff member (`assigneeId`)
 * when set, otherwise every OWNER/ADMIN/MANAGER of the org (the same
 * fallback the invoice-overdue and inventory-reorder-alert sweeps use).
 * `reminderSentAt` is a one-shot guard (guarded `updateMany`, same pattern
 * as those sweeps), so a re-run or a concurrent sweep never double-reminds.
 *
 * Fail-soft: without a database the job is a no-op; a per-appointment error
 * is logged and the loop continues. Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { AppointmentStatus, NotificationKind, Role } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  EVENT_APPOINTMENT_REMINDER_SENT,
  JOB_APPOINTMENT_REMINDER_SWEEP,
  REMINDER_SWEEP_BATCH_SIZE,
  REMINDER_WINDOW_HOURS,
} from './appointment.constants';

export interface AppointmentReminderJobData {
  limit?: number;
}

export interface AppointmentReminderResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  reminded: number;
  failed: number;
}

const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];
const HOLDING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

@Processor(QUEUE_OPS_JOBS)
export class AppointmentReminderWorker extends WorkerHost {
  private readonly logger = new Logger(AppointmentReminderWorker.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<AppointmentReminderJobData>): Promise<AppointmentReminderResult> {
    if (job.name !== JOB_APPOINTMENT_REMINDER_SWEEP) {
      return { ran: false, skipped: 'name mismatch', candidates: 0, reminded: 0, failed: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('appointment reminder sweep skipped: db not configured');
      return { ran: false, skipped: 'not configured', candidates: 0, reminded: 0, failed: 0 };
    }

    const prisma = this.prisma;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);
    const limit = clampLimit(job.data?.limit);
    const candidates = await prisma.appointment.findMany({
      where: {
        status: { in: HOLDING_STATUSES },
        reminderSentAt: null,
        startAt: { gte: now, lte: windowEnd },
      },
      orderBy: { startAt: 'asc' },
      take: limit,
    });
    if (candidates.length === 0) {
      return { ran: true, candidates: 0, reminded: 0, failed: 0 };
    }

    const recipientsByOrg = new Map<string, string[]>();
    let reminded = 0;
    let failed = 0;
    for (const appointment of candidates) {
      try {
        const claimed = await prisma.appointment.updateMany({
          where: { id: appointment.id, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        if (claimed.count === 0) continue;

        const recipients = appointment.assigneeId
          ? [appointment.assigneeId]
          : await this.recipientsForOrg(appointment.organizationId, recipientsByOrg);
        if (recipients.length > 0) {
          await prisma.notification.createMany({
            data: recipients.map((userId) => ({
              organizationId: appointment.organizationId,
              userId,
              kind: NotificationKind.IN_APP,
              title: `Upcoming: ${appointment.title}`,
              body: `Starts ${appointment.startAt.toISOString()}.`,
              payload: {
                appointmentId: appointment.id,
                startAt: appointment.startAt.toISOString(),
              },
            })),
          });
        }
        await this.emitReminderSent(appointment.id, appointment.organizationId);
        reminded += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `reminder failed for appointment ${appointment.id}: ${(error as Error)?.message}`,
        );
      }
    }

    this.logger.log(
      `appointment reminder sweep: ${reminded} reminded, ${failed} failed of ${candidates.length} candidates`,
    );
    return { ran: true, candidates: candidates.length, reminded, failed };
  }

  private async recipientsForOrg(
    organizationId: string,
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    const cached = cache.get(organizationId);
    if (cached) return cached;
    const members = await this.prisma!.member.findMany({
      where: { organizationId, role: { in: ALERT_ROLES } },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((member) => member.userId))];
    cache.set(organizationId, ids);
    return ids;
  }

  private async emitReminderSent(appointmentId: string, organizationId: string): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'appointment',
        aggregateId: appointmentId,
        eventType: EVENT_APPOINTMENT_REMINDER_SENT,
        payload: { appointmentId, organizationId },
      });
    } catch (error) {
      this.logger.warn(`reminder outbox append skipped: ${(error as Error)?.message}`);
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return REMINDER_SWEEP_BATCH_SIZE;
  }
  return Math.min(Math.trunc(limit), REMINDER_SWEEP_BATCH_SIZE);
}
