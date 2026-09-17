/**
 * ConversationsModule: customer conversation ingestion CRUD (DATABASE_SPEC
 * §3, §5, API_SPEC §11.6, §11.8). HTTP-only — `ConversationWorker` and
 * `ConversationSummaryWorker` live in `conversation-worker.module.ts`, split
 * out so `worker-app.module.ts` never instantiates `ConversationController`
 * (DEVOPS_SPEC §3). Without a database the endpoints fail with a contract
 * error.
 */
import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationsModule {}
