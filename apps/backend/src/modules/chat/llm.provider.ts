/**
 * LlmProvider: OpenAI-compatible `/chat/completions` client for grounded QA
 * (AI_ARCHITECTURE §6–§8, API_SPEC §11.5).
 *
 * Single-shot (non-streaming) completions: deterministic Q&A is one request,
 * no agentic loop (§7). Without `LLM_API_URL` every call throws
 * `LLM_UNAVAILABLE` (503) instead of a 500.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CHAT_MAX_TOKENS } from './chat.constants';
import type { LlmConfig } from './llm.config';

interface ChatCompletionResponse {
  choices: Array<{ message?: { content?: string } }>;
}

@Injectable()
export class LlmProvider {
  private readonly logger = new Logger(LlmProvider.name);

  constructor(@Optional() private readonly config?: LlmConfig) {}

  get isConfigured(): boolean {
    return this.config !== undefined;
  }

  /** Runs a single completion; returns the model's text output. */
  async complete(system: string, user: string): Promise<string> {
    if (!this.config) {
      throw new ApiError({
        code: HttpErrorCode.LLM_UNAVAILABLE,
        status: 503,
        message: 'LLM is not configured',
      });
    }
    try {
      const response = await fetch(`${this.config.apiUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          max_tokens: CHAT_MAX_TOKENS,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `chat completions HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }
      const body = (await response.json()) as ChatCompletionResponse;
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('unexpected chat completions response shape');
      }
      return content;
    } catch (error) {
      this.logger.error(`llm complete failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.LLM_UNAVAILABLE,
        status: 503,
        message: 'LLM is unavailable',
      });
    }
  }
}
