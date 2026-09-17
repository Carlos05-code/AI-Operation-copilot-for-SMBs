/**
 * NotificationDeliveryWorker: consumes `notification.delivery.sweep` jobs on
 * the (long-registered, previously idle) `notifications` queue (ROADMAP
 * Phase 3 — notifications in-app, WhatsApp, email).
 *
 * Every `Notification` row is created `PENDING` regardless of caller (the
 * invoice-overdue and inventory-reorder-alert workers already create rows
 * this way, unmodified — delivery is decoupled and fully additive). This
 * sweep delivers each `PENDING`/`FAILED` row by `kind`: `WHATSAPP` sends via
 * `WhatsAppProvider` to the recipient's `User.whatsapp`; everything else
 * (`IN_APP`, `EMAIL`) sends via `EmailProvider` to `User.email`, exactly the
 * behavior before `WhatsAppProvider` existed — every current caller creates
 * `IN_APP` rows, so this is additive, not a change to existing delivery.
 * Outcomes are claimed with a guarded `updateMany` (the same pattern as the
 * invoice-overdue and reorder-alert sweeps).
 *
 * Failures — no provider configured, no contact on file, or a thrown send
 * error — leave the row `FAILED` rather than a terminal `SKIPPED`: the next
 * sweep re-queries `PENDING`/`FAILED` and retries, so a transient outage or
 * a later-added provider config self-heals without operator intervention
 * (the same "leave state as-is, let the next sweep re-attempt" contract as
 * the invoice-overdue worker). Only `SENT` is terminal.
 *
 * Fail-soft: without a database the job is a no-op; a per-notification
 * error is logged and the loop continues. Non-matching job names are
 * skipped (the queue may host more processors later).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { NotificationDeliveryStatus, NotificationKind } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { QUEUE_NOTIFICATIONS } from '../queue/queue.constants';
import {
  DELIVERY_ERROR_MAX_LENGTH,
  JOB_NOTIFICATION_DELIVERY_SWEEP,
  NOTIFICATION_DELIVERY_BATCH_SIZE,
} from './notification.constants';
import { EmailProvider } from './email.provider';
import { WhatsAppProvider } from './whatsapp.provider';

export interface NotificationDeliveryJobData {
  limit?: number;
}

export interface NotificationDeliveryResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  sent: number;
  failed: number;
}

const RETRYABLE_STATUSES: NotificationDeliveryStatus[] = [
  NotificationDeliveryStatus.PENDING,
  NotificationDeliveryStatus.FAILED,
];

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationDeliveryWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);

  constructor(
    private readonly email: EmailProvider,
    private readonly whatsapp: WhatsAppProvider,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    super();
  }

  async process(job: Job<NotificationDeliveryJobData>): Promise<NotificationDeliveryResult> {
    if (job.name !== JOB_NOTIFICATION_DELIVERY_SWEEP) {
      return { ran: false, skipped: 'name mismatch', candidates: 0, sent: 0, failed: 0 };
    }
    if (!this.prisma) {
      this.logger.warn('notification delivery sweep skipped: db not configured');
      return { ran: false, skipped: 'not configured', candidates: 0, sent: 0, failed: 0 };
    }

    const prisma = this.prisma;
    const limit = clampLimit(job.data?.limit);
    const pending = await prisma.notification.findMany({
      where: { deliveryStatus: { in: RETRYABLE_STATUSES } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, userId: true, kind: true, title: true, body: true, deliveryStatus: true },
    });
    if (pending.length === 0) {
      return { ran: true, candidates: 0, sent: 0, failed: 0 };
    }

    const userIds = [...new Set(pending.map((n) => n.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, whatsapp: true },
    });
    const contactByUserId = new Map(users.map((u) => [u.id, u]));

    let sent = 0;
    let failed = 0;
    for (const notification of pending) {
      try {
        const contact = contactByUserId.get(notification.userId);

        if (notification.kind === NotificationKind.WHATSAPP) {
          if (!contact?.whatsapp) throw new Error('no whatsapp number on file for this user');
          if (!this.whatsapp.isConfigured) throw new Error('whatsapp provider not configured');
          await this.whatsapp.send({
            to: contact.whatsapp,
            body: notification.body ?? notification.title,
          });
        } else {
          if (!contact?.email) throw new Error('no email on file for this user');
          if (!this.email.isConfigured) throw new Error('email provider not configured');
          await this.email.send({
            to: contact.email,
            subject: notification.title,
            text: notification.body ?? notification.title,
          });
        }

        const claimed = await this.claim(notification.id, notification.deliveryStatus, {
          deliveryStatus: NotificationDeliveryStatus.SENT,
          deliveredAt: new Date(),
          deliveryError: null,
        });
        if (claimed) sent += 1;
      } catch (error) {
        const message = (error as Error)?.message ?? 'unknown error';
        this.logger.warn(`notification ${notification.id} delivery failed: ${message}`);
        const claimed = await this.claim(notification.id, notification.deliveryStatus, {
          deliveryStatus: NotificationDeliveryStatus.FAILED,
          deliveryError: message.slice(0, DELIVERY_ERROR_MAX_LENGTH),
        });
        if (claimed) failed += 1;
      }
    }

    this.logger.log(
      `notification delivery sweep: ${sent} sent, ${failed} failed of ${pending.length} candidates`,
    );
    return { ran: true, candidates: pending.length, sent, failed };
  }

  /** Guarded transition so a concurrent sweep can't double-send. */
  private async claim(
    id: string,
    fromStatus: NotificationDeliveryStatus,
    data: {
      deliveryStatus: NotificationDeliveryStatus;
      deliveryError: string | null;
      deliveredAt?: Date;
    },
  ): Promise<boolean> {
    const result = await this.prisma!.notification.updateMany({
      where: { id, deliveryStatus: fromStatus },
      data,
    });
    return result.count > 0;
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return NOTIFICATION_DELIVERY_BATCH_SIZE;
  }
  return Math.min(Math.trunc(limit), NOTIFICATION_DELIVERY_BATCH_SIZE);
}
