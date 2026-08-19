/**
 * ChatModule: grounded Q&A over the knowledge base (AI_ARCHITECTURE §6–§10).
 *
 * The LLM provider is inert without `LLM_API_URL` (fail-soft at boot); chat
 * requests then fail with `LLM_UNAVAILABLE` (503). Retrieval comes from
 * SearchModule (3-store hybrid fusion), which is itself fail-soft.
 */
import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { llmConfig } from './llm.config';
import { LlmProvider } from './llm.provider';

@Module({
  imports: [SearchModule],
  controllers: [ChatController],
  providers: [
    {
      provide: LlmProvider,
      useFactory: () => {
        const config = llmConfig();
        return config ? new LlmProvider(config) : new LlmProvider(undefined);
      },
    },
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
