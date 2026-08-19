/**
 * ConversationsModule: customer conversation ingestion (DATABASE_SPEC §3, §5).
 *
 * Persists conversations/messages in PostgreSQL and enqueues `conversation.embed`
 * jobs on the shared `ai-jobs` queue; ConversationWorker indexes them into
 * Qdrant `conversation_{org}`. All external services are optional at boot
 * (fail-soft): without Redis the embedding job is skipped, without
 * embeddings/Qdrant the worker skips, without a database the endpoints fail
 * with a contract error.
 */
import { Module } from '@nestjs/common';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationWorker } from './conversation.worker';

@Module({
  imports: [EmbeddingsModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationWorker],
  exports: [ConversationService],
})
export class ConversationsModule {}
