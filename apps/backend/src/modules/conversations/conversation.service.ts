/**
 * ConversationService: customer conversation ingestion (ROADMAP Phase 2,
 * DATABASE_SPEC §3, §5, API_SPEC §11.6).
 *
 * Flow (`POST /api/v1/conversations`): persist the conversation (idempotent
 * via `(organization_id, external_id)` when an external id is supplied),
 * insert messages (`createMany` with `skipDuplicates` for at-least-once
 * replays), emit `conversation.ingested` on the outbox, and enqueue an
 * `ai-jobs` embedding job for the `conversation_{org}` Qdrant collection
 * (fire-and-forget, same fail-soft contract as document ingestion).
 *
 * The database row is the system of record: outbox/queue failures are logged
 * and never fail the request.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Conversation, ConversationChannel, MessageSender } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QueueService } from '../queue/queue.service';
import { EVENT_CONVERSATION_INGESTED, JOB_CONVERSATION_EMBED } from './conversation.constants';

export interface CreateConversationInput {
  organizationId: string;
  channel: ConversationChannel;
  externalId?: string;
  customerId?: string;
  title?: string;
  messages: Array<{
    sender: MessageSender;
    body: string;
    sentAt: Date;
    externalId?: string;
  }>;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  /** Persists a conversation with its messages (idempotent per externalId). */
  async create(input: CreateConversationInput): Promise<{
    conversation: Conversation;
    messagesCreated: number;
  }> {
    const prisma = this.requirePrisma();
    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!customer) {
        throw new ApiError({
          code: HttpErrorCode.NOT_FOUND,
          status: 404,
          message: 'Customer not found in this organization',
        });
      }
    }

    const conversation = input.externalId
      ? await prisma.conversation.upsert({
          where: {
            organizationId_externalId: {
              organizationId: input.organizationId,
              externalId: input.externalId,
            },
          },
          create: {
            organizationId: input.organizationId,
            customerId: input.customerId,
            channel: input.channel,
            externalId: input.externalId,
            title: input.title,
          },
          update: { customerId: input.customerId, title: input.title },
        })
      : await prisma.conversation.create({
          data: {
            organizationId: input.organizationId,
            customerId: input.customerId,
            channel: input.channel,
            title: input.title,
          },
        });

    const messagesCreated = await prisma.message.createMany({
      data: input.messages.map((message) => ({
        conversationId: conversation.id,
        sender: message.sender,
        body: message.body,
        sentAt: message.sentAt,
        externalId: message.externalId,
      })),
      skipDuplicates: true,
    });

    await this.notify(conversation, input.messages.length);
    return { conversation, messagesCreated: messagesCreated.count };
  }

  /** Fires the outbox event and the embedding job; never fails the write. */
  private async notify(conversation: Conversation, messageCount: number): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'conversation',
        aggregateId: conversation.id,
        eventType: EVENT_CONVERSATION_INGESTED,
        payload: {
          id: conversation.id,
          organizationId: conversation.organizationId,
          customerId: conversation.customerId,
          channel: conversation.channel,
          messageCount,
        },
      });
    } catch (error) {
      this.logger.warn(`conversation outbox append skipped: ${(error as Error)?.message}`);
    }
    if (!this.queue) return;
    try {
      await this.queue.enqueue('ai-jobs', JOB_CONVERSATION_EMBED, {
        conversationId: conversation.id,
        organizationId: conversation.organizationId,
      });
    } catch (error) {
      // Redis down must not fail ingestion; embedding can be re-scheduled
      // later from the event bus.
      this.logger.warn(`conversation embed job enqueue skipped: ${(error as Error)?.message}`);
    }
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
