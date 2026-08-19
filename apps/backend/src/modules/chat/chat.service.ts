/**
 * ChatService: grounded document Q&A (AI_ARCHITECTURE §6–§10, API_SPEC §11.5).
 *
 * Pipeline: hybrid retrieval (3-store RRF) → context budget → `qa.document`
 * prompt → single-shot LLM completion → deterministic grounding (citation
 * validation + quality gate). When retrieval finds nothing, the LLM is never
 * called and a disclaimer is returned (§9.1). Chat cannot work without a
 * model, so LLM failures surface as `LLM_UNAVAILABLE` (503).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { HybridSearchService } from '../search/hybrid-search.service';
import type { SearchHit } from '../search/search.service';
import {
  CHAT_CONTEXT_BUDGET_CHARS,
  CHAT_CHUNK_LIMIT_CHARS,
  CHAT_DEFAULT_LIMIT,
} from './chat.constants';
import { groundAnswer, parseLlmAnswer, type GroundedAnswer } from './grounding';
import { LlmProvider } from './llm.provider';
import { buildQaUserPrompt, hitToContext, QA_SYSTEM_PROMPT } from './qa.prompt';

const NO_MATCH_ANSWER =
  "I could not find any relevant information in this organization's knowledge base for that question.";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly hybrid: HybridSearchService,
    private readonly llm: LlmProvider,
  ) {}

  /** Answers a question over the org knowledge base with citations. */
  async answer(
    organizationId: string,
    query: string,
    limit: number = CHAT_DEFAULT_LIMIT,
  ): Promise<GroundedAnswer> {
    const hits = await this.hybrid.search(organizationId, query, limit);
    if (hits.length === 0) {
      return {
        answer: NO_MATCH_ANSWER,
        citations: [],
        confidence: 0,
        grounded: false,
        synthesis: 'fallback',
      };
    }

    const context = this.buildContext(hits);
    const output = await this.llm.complete(QA_SYSTEM_PROMPT, buildQaUserPrompt(query, context));
    try {
      return groundAnswer(parseLlmAnswer(output), context);
    } catch (error) {
      this.logger.error(`llm answer unparseable: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.LLM_UNAVAILABLE,
        status: 503,
        message: 'LLM returned an unparseable answer',
      });
    }
  }

  /** Trims per-chunk text to the budget; elides the tail beyond the total. */
  private buildContext(hits: SearchHit[]): Array<ContextSource> {
    const chunks = hits.map((hit) => hitToContext(hit, CHAT_CHUNK_LIMIT_CHARS));
    let remaining = CHAT_CONTEXT_BUDGET_CHARS;
    const kept: ContextSource[] = [];
    for (const chunk of chunks) {
      if (remaining <= 0) break;
      const text =
        chunk.text.length > remaining ? `${chunk.text.slice(0, remaining)}…` : chunk.text;
      const source = hits.find(
        (h) => h.documentId === chunk.documentId && h.chunkId === chunk.chunkId,
      );
      kept.push({ ...chunk, text, score: source?.score ?? 0 });
      remaining -= text.length;
    }
    return kept;
  }
}

interface ContextSource {
  documentId: string;
  chunkId: string;
  page: number | null;
  score: number;
  text: string;
}
