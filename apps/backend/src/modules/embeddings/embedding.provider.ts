/**
 * EmbeddingProvider: OpenAI-compatible `/embeddings` client (AI_ARCHITECTURE §5).
 *
 * Works with any OpenAI-compatible endpoint — BGE-M3 behind vLLM/OpenSearch,
 * OpenAI, or a local gateway. Fail-soft: without `EMBEDDINGS_API_URL` every
 * call throws `EMBEDDINGS_UNAVAILABLE` (503) instead of a 500.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import type { EmbeddingProviderConfig } from './embeddings.config';

interface EmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
}

@Injectable()
export class EmbeddingProvider {
  private readonly logger = new Logger(EmbeddingProvider.name);

  constructor(@Optional() private readonly config?: EmbeddingProviderConfig) {}

  get isConfigured(): boolean {
    return this.config !== undefined;
  }

  get dimension(): number | undefined {
    return this.config?.dimension;
  }

  /** Embeds a batch of texts; returns one vector per input, in order. */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.config) {
      throw new ApiError({
        code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE,
        status: 503,
        message: 'Embeddings API is not configured',
      });
    }
    if (texts.length === 0) return [];
    try {
      const response = await fetch(`${this.config.apiUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.config.model, input: texts }),
      });
      if (!response.ok) {
        throw new Error(
          `embeddings HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }
      const body = (await response.json()) as EmbeddingsResponse;
      if (!Array.isArray(body.data) || body.data.length !== texts.length) {
        throw new Error('unexpected embeddings response shape');
      }
      return body.data.map((entry) => entry.embedding);
    } catch (error) {
      this.logger.error(`embed failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE,
        status: 503,
        message: 'Embeddings API is unavailable',
      });
    }
  }
}
