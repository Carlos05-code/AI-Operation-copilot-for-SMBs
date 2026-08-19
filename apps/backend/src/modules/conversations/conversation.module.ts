/**
 * ConversationsModule: customer conversation ingestion + summaries
 * (DATABASE_SPEC §3, §5, API_SPEC §11.6, §11.8).
 *
 * Persists conversations/messages in PostgreSQL and enqueues
 * `conversation.embed` jobs on the shared `ai-jobs` queue;
 * ConversationWorker indexes them into Qdrant `conversation_{org}`.
 * `POST /:id/summarize` schedules `conversation.summarize` on the
 * `summary-jobs` queue; ConversationSummaryWorker runs the LLM and persists
 * the summary on the row. All external services are optional at boot
 * (fail-soft): without Redis jobs are skipped, without embeddings/Qdrant
 * the embed worker skips, without an LLM config the summary worker skips,
 * without a database the endpoints fail with a contract error.
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationSummaryWorker } from './conversation.summary.worker';
import { ConversationWorker } from './conversation.worker';

@Module({
  imports: [EmbeddingsModule, ChatModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationWorker, ConversationSummaryWorker],
  exports: [ConversationService],
})
export class ConversationsModule {}
