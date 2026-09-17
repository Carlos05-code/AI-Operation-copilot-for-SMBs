/**
 * LlmModule: just `LlmProvider`, split out of `chat.module.ts` so the four
 * other feature modules whose *workers* need an LLM (tasks, insights,
 * purchasing, conversations) can import it without also pulling in
 * `ChatController` and `SearchModule` (DEVOPS_SPEC §3) — importing
 * `ChatModule` for this used to do exactly that.
 */
import { Module } from '@nestjs/common';
import { createLlmProvider } from './llm.config';
import { LlmProvider } from './llm.provider';

@Module({
  providers: [{ provide: LlmProvider, useFactory: createLlmProvider }],
  exports: [LlmProvider],
})
export class LlmModule {}
