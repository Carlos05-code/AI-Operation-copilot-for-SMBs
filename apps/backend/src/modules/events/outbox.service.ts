/**
 * OutboxService: transactional outbox + relay (DATABASE_SPEC §10, ADR-0007).
 *
 * Business flows call `append()` inside their database transaction to record
 * a domain event atomically. A background relay (5s poll) claims PENDING
 * events, publishes each to the RabbitMQ bus using the event type as the
 * routing key, and marks the row PROCESSED with `processed_at`; a failed
 * publish marks the row FAILED for inspection. At-least-once delivery holds
 * because a row is only marked PROCESSED after a successful publish.
 *
 * Fail-soft: with no database and/or no bus the service is inert, so local
 * runs without infra still boot.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EventBusService } from './event-bus.service';
import { OUTBOX_POLL_BATCH_SIZE, OUTBOX_POLL_INTERVAL_MS } from './events.constants';

export interface OutboxAppendInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonObject;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly bus?: EventBusService,
  ) {}

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** Records a domain event for later publishing (call within a tx). */
  async append(input: OutboxAppendInput): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'PENDING',
      },
    });
  }

  /** Starts the relay loop when both DB and bus are configured. */
  start(): void {
    if (this.timer || !this.prisma || !this.bus) return;
    this.timer = setInterval(() => {
      void this.relayOnce().catch((error: unknown) => {
        this.logger.error(`outbox relay iteration failed: ${(error as Error)?.message}`);
      });
    }, OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
    this.logger.log(`outbox relay started (every ${OUTBOX_POLL_INTERVAL_MS}ms)`);
  }

  /** Discovers the first relayed events; returns the number published. */
  async relayOnce(): Promise<number> {
    if (!this.prisma || !this.bus || !this.bus.isConnected) return 0;
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: OUTBOX_POLL_BATCH_SIZE,
    });

    let published = 0;
    for (const event of pending) {
      const payload = (event.payload ?? {}) as Prisma.JsonObject;
      const ok = await this.bus.publish(event.eventType, {
        aggregate: { type: event.aggregateType, id: event.aggregateId },
        eventType: event.eventType,
        payload,
      });
      if (!ok) {
        await this.markFailed(event.id);
        continue;
      }
      await this.markProcessed(event.id);
      published += 1;
    }
    return published;
  }

  /** Stops the relay loop (idempotent). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async markProcessed(id: string): Promise<void> {
    await this.prisma?.outboxEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }

  private async markFailed(id: string): Promise<void> {
    await this.prisma?.outboxEvent.update({ where: { id }, data: { status: 'FAILED' } });
  }
}
