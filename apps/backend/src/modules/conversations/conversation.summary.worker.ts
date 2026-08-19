/**
 * ConversationSummaryWorker: consumes `conversation.summarize` jobs on the
 * `summary-jobs` queue (AI_ARCHITECTURE §6.1, API_SPEC §11.8).
 *
 * Pipeline: load the conversation + messages → window the transcript to the
 * context budget (keep the tail; older messages are dropped) → run the LLM
 * with the `summarize.conversation.v1` prompt → parse the JSON contract →
 * persist `summary` + `summaryGeneratedAt` on the row → emit
 * `conversation.summarized` on the outbox.
 *
 * Idempotent: when every message predates the existing summary the job is a
 * no-op (`skipped: 'already summarized'`), so re-runs after Redis outages
 * never waste a model call. Fail-soft: without a database or LLM config the
 * job skips; LLM call failures throw so BullMQ retries; outbox failures are
 * logged, not fatal. Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Message } from '@prisma/client';
import { LlmProvider } from '../chat/llm.provider';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_SUMMARY_JOBS } from '../queue/queue.constants';
import {
  CONVERSATION_SUMMARY_CONTEXT_CHARS,
  CONVERSATION_SUMMARY_MAX_TOKENS,
  EVENT_CONVERSATION_SUMMARIZED,
  JOB_CONVERSATION_SUMMARIZE,
  SUMMARY_PROMPT_VERSION,
} from './conversation.constants';
import { SUMMARIZE_SYSTEM_PROMPT, buildSummarizeUserPrompt } from './conversation.prompt';

export interface ConversationSummaryJobData {
  conversationId: string;
  organizationId: string;
}

export interface ConversationSummaryResult {
  conversationId: string;
  summarized: boolean;
  skipped?: string;
}

interface SummaryPayload {
  summary: string;
  keyPoints: string[];
}

@Processor(QUEUE_SUMMARY_JOBS)
export class ConversationSummaryWorker extends WorkerHost {
  private readonly logger = new Logger(ConversationSummaryWorker.name);

  constructor(
    private readonly llm: LlmProvider,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<ConversationSummaryJobData>): Promise<ConversationSummaryResult> {
    if (job.name !== JOB_CONVERSATION_SUMMARIZE) {
      return {
        conversationId: job.data.conversationId,
        summarized: false,
        skipped: 'name mismatch',
      };
    }
    const { conversationId, organizationId } = job.data;
    if (!this.prisma) {
      this.logger.warn(`conversation summary skipped for ${conversationId}: db not configured`);
      return { conversationId, summarized: false, skipped: 'not configured' };
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { messages: { orderBy: { sentAt: 'asc' as const } } },
    });
    if (!conversation) {
      this.logger.warn(`conversation summary skipped: ${conversationId} not found`);
      return { conversationId, summarized: false, skipped: 'conversation not found' };
    }
    if (conversation.messages.length === 0) {
      return { conversationId, summarized: false, skipped: 'no messages' };
    }
    const lastMessageAt = conversation.messages[conversation.messages.length - 1].sentAt;
    if (conversation.summaryGeneratedAt && conversation.summaryGeneratedAt >= lastMessageAt) {
      this.logger.log(`conversation summary skipped for ${conversationId}: already fresh`);
      return { conversationId, summarized: false, skipped: 'already summarized' };
    }

    const windowed = this.windowTranscript(conversation.messages);
    if (!this.llm.isConfigured) {
      this.logger.warn(`conversation summary skipped for ${conversationId}: llm not configured`);
      return { conversationId, summarized: false, skipped: 'llm not configured' };
    }

    const content = await this.llm.complete(
      SUMMARIZE_SYSTEM_PROMPT,
      buildSummarizeUserPrompt({
        channel: conversation.channel,
        title: conversation.title,
        messages: windowed.messages,
        truncated: windowed.truncated,
      }),
      CONVERSATION_SUMMARY_MAX_TOKENS,
    );
    const payload = parseSummaryPayload(content);
    if (!payload) {
      throw new Error('summarizer returned malformed JSON payload');
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { summary: payload.summary, summaryGeneratedAt: new Date() },
    });

    try {
      await this.outbox?.append({
        aggregateType: 'conversation',
        aggregateId: conversation.id,
        eventType: EVENT_CONVERSATION_SUMMARIZED,
        payload: {
          conversationId: conversation.id,
          organizationId,
          promptVersion: SUMMARY_PROMPT_VERSION,
          keyPoints: payload.keyPoints,
        },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`summarized conversation ${conversation.id}`);
    return { conversationId: conversation.id, summarized: true };
  }

  /** Keeps the tail of the transcript within the context budget. */
  private windowTranscript(messages: Array<Pick<Message, 'sender' | 'body' | 'sentAt'>>): {
    messages: Array<Pick<Message, 'sender' | 'body' | 'sentAt'>>;
    truncated: boolean;
  } {
    let total = 0;
    const kept: Array<Pick<Message, 'sender' | 'body' | 'sentAt'>> = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const size = message.body.length + 40;
      if (total + size > CONVERSATION_SUMMARY_CONTEXT_CHARS && kept.length > 0) break;
      kept.unshift(message);
      total += size;
    }
    return { messages: kept, truncated: kept.length < messages.length };
  }
}

function parseSummaryPayload(content: string): SummaryPayload | null {
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<SummaryPayload>;
    if (
      typeof parsed.summary !== 'string' ||
      parsed.summary.length === 0 ||
      !Array.isArray(parsed.keyPoints)
    ) {
      return null;
    }
    return {
      summary: parsed.summary,
      keyPoints: parsed.keyPoints.filter((p) => typeof p === 'string'),
    };
  } catch {
    return null;
  }
}
