/**
 * ChatModule: grounded Q&A over the knowledge base (AI_ARCHITECTURE §6–§10).
 * HTTP-only — `LlmProvider` itself lives in `llm.module.ts` so worker-only
 * consumers don't need `ChatController`/`SearchModule` (DEVOPS_SPEC §3).
 *
 * The LLM provider is inert without `LLM_API_URL` (fail-soft at boot); chat
 * requests then fail with `LLM_UNAVAILABLE` (503). Retrieval comes from
 * SearchModule (3-store hybrid fusion), which is itself fail-soft.
 */
import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmModule } from './llm.module';

@Module({
  imports: [SearchModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
