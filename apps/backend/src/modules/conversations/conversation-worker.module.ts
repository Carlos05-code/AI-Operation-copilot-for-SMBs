/**
 * ConversationsWorkerModule: the two workers from `conversation.module.ts`,
 * split out so `worker-app.module.ts` never instantiates
 * `ConversationController` (DEVOPS_SPEC §3). `ConversationWorker` indexes
 * conversations into Qdrant `conversation_{org}`; `ConversationSummaryWorker`
 * runs the LLM and persists the summary on the row. Both are fail-soft:
 * without embeddings/Qdrant the embed worker skips, without an LLM config
 * the summary worker skips.
 */
import { Module } from '@nestjs/common';
import { LlmModule } from '../chat/llm.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ConversationSummaryWorker } from './conversation.summary.worker';
import { ConversationWorker } from './conversation.worker';

@Module({
  imports: [EmbeddingsModule, LlmModule],
  providers: [ConversationWorker, ConversationSummaryWorker],
})
export class ConversationsWorkerModule {}
