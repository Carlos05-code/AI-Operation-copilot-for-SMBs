/**
 * ConversationWorker: consumes `conversation.embed` jobs on the `ai-jobs`
 * queue (DATABASE_SPEC §5).
 *
 * Pipeline: load the conversation + messages from PostgreSQL → embed message
 * bodies in batches → upsert per-message vectors into the org's
 * `conversation_{org}` collection (deterministic point ids, idempotent) →
 * emit `conversation.embedded` on the outbox.
 *
 * Fail-soft: when embeddings/Qdrant/database are not configured the job is
 * skipped (never fails); transient failures throw so BullMQ retries. Outbox
 * write failures are logged, not fatal. Non-matching job names are skipped so
 * both `ai-jobs` processors can coexist on the queue.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { OutboxService } from '../events/outbox.service';
import { EmbeddingProvider } from '../embeddings/embedding.provider';
import { EMBEDDING_BATCH_SIZE } from '../embeddings/embeddings.constants';
import { VectorStoreService } from '../embeddings/vector-store.service';
import { PrismaService } from '../database/prisma.service';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import { EVENT_CONVERSATION_EMBEDDED, JOB_CONVERSATION_EMBED } from './conversation.constants';

export interface ConversationEmbedJobData {
  conversationId: string;
  organizationId: string;
}

export interface ConversationEmbedResult {
  conversationId: string;
  embeddedMessages: number;
}

@Processor(QUEUE_AI_JOBS)
export class ConversationWorker extends WorkerHost {
  private readonly logger = new Logger(ConversationWorker.name);

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStoreService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<ConversationEmbedJobData>): Promise<unknown> {
    if (job.name !== JOB_CONVERSATION_EMBED) {
      return { skipped: true };
    }
    const { conversationId, organizationId } = job.data;
    if (!this.provider.isConfigured || !this.vectorStore.isConfigured || !this.prisma) {
      this.logger.warn(
        `conversation embedding skipped for ${conversationId}: embeddings/qdrant/db not configured`,
      );
      return { skipped: 'not configured' };
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { messages: { orderBy: { sentAt: 'asc' as const } } },
    });
    if (!conversation) {
      this.logger.warn(`conversation embedding skipped: ${conversationId} not found`);
      return { skipped: 'conversation not found' };
    }

    const vectors: number[][] = [];
    for (let offset = 0; offset < conversation.messages.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = conversation.messages.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      vectors.push(...(await this.provider.embed(batch.map((message) => message.body))));
    }

    await this.vectorStore.upsertConversationMessages(
      organizationId,
      conversation.id,
      conversation.customerId,
      conversation.channel,
      conversation.messages.map((message, index) => ({
        messageId: message.id,
        sender: message.sender,
        body: message.body,
        sentAt: message.sentAt,
        vector: vectors[index],
      })),
    );

    try {
      await this.outbox?.append({
        aggregateType: 'conversation',
        aggregateId: conversation.id,
        eventType: EVENT_CONVERSATION_EMBEDDED,
        payload: {
          conversationId: conversation.id,
          organizationId,
          messageCount: conversation.messages.length,
        },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`embedded ${conversation.messages.length} messages for ${conversation.id}`);
    return {
      conversationId: conversation.id,
      embeddedMessages: conversation.messages.length,
    } satisfies ConversationEmbedResult;
  }
}
