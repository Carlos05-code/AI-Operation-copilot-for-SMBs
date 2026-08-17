/**
 * SearchService: OpenSearch wrapper for org-scoped full-text indexing and
 * retrieval (ADR-0012, DATABASE_SPEC §6).
 *
 * One index per organization (`search_{org}`) with keyword payload fields and
 * a `text` field analyzed for keyword search. Document ids are deterministic
 * (`sha1(documentId:index)`, same scheme as the vector store) so re-runs are
 * idempotent.
 *
 * Fail-soft: without `OPENSEARCH_URL` every call throws `SEARCH_UNAVAILABLE`
 * (503). A missing index is an empty result set, not an error.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { chunkPointId } from '../embeddings/vector-store.service';
import { SEARCH_INDEX_PREFIX, SEARCH_TEXT_LIMIT } from './search.constants';

export interface IndexedChunk {
  index: number;
  text: string;
}

/** A single retrieval hit, store-agnostic (shared by Qdrant + OpenSearch). */
export interface SearchHit {
  documentId: string;
  chunkId: string;
  text: string;
  page: number | null;
  score: number;
}

/** Document shape stored on each indexed chunk (written by this service). */
interface SearchSource {
  source_document_id?: string;
  chunk_id?: string;
  text?: string;
  page?: number | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(@Optional() private readonly client?: OpenSearchClient) {}

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  indexName(organizationId: string): string {
    return `${SEARCH_INDEX_PREFIX}${organizationId}`;
  }

  /** Ensures the org index exists with the chunk mappings. */
  async ensureIndex(organizationId: string): Promise<string> {
    const client = this.requireClient();
    const name = this.indexName(organizationId);
    try {
      const exists = await client.indices.exists({ index: name });
      if (!exists.body) {
        await client.indices.create({
          index: name,
          body: {
            mappings: {
              properties: {
                text: { type: 'text' },
                org_id: { type: 'keyword' },
                source_document_id: { type: 'keyword' },
                chunk_id: { type: 'keyword' },
                page: { type: 'integer' },
              },
            },
          },
        });
        this.logger.log(`created index ${name}`);
      }
      return name;
    } catch (error) {
      this.logger.error(`index ${name} unavailable: ${(error as Error)?.message}`);
      throw this.unavailable('Full-text search is unavailable');
    }
  }

  /** Indexes a document's chunks (bulk, deterministic ids, idempotent). */
  async indexChunks(
    organizationId: string,
    documentId: string,
    chunks: IndexedChunk[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const name = await this.ensureIndex(organizationId);
    const body = chunks.flatMap((chunk) => [
      { index: { _index: name, _id: chunkPointId(documentId, chunk.index) } },
      {
        source: {
          org_id: organizationId,
          source_document_id: documentId,
          chunk_id: `${documentId}:${chunk.index}`,
          page: null,
          text: chunk.text.slice(0, SEARCH_TEXT_LIMIT),
        },
      },
    ]);
    try {
      const response = await this.requireClient().bulk({ body });
      if (response.body.errors) {
        const sample = (response.body.items ?? [])
          .map((item: { index?: { error?: { reason?: string } } }) => item.index?.error?.reason)
          .find(Boolean);
        throw new Error(sample ?? 'bulk indexing rejected some chunks');
      }
    } catch (error) {
      this.logger.error(`bulk index into ${name} failed: ${(error as Error)?.message}`);
      throw this.unavailable('Full-text search is unavailable');
    }
  }

  /** Keyword search over the org index (BM25 via multi_match on `text`). */
  async searchFullText(organizationId: string, query: string, limit = 10): Promise<SearchHit[]> {
    const client = this.requireClient();
    const name = this.indexName(organizationId);
    try {
      const response = await client.search({
        index: name,
        size: limit,
        body: {
          query: {
            bool: {
              filter: [{ term: { org_id: organizationId } }],
              must: [{ multi_match: { query, fields: ['text'] } }],
            },
          },
        },
      });
      return (response.body.hits?.hits ?? []).map((hit: Record<string, unknown>) => {
        const source = (hit._source ?? {}) as SearchSource;
        return {
          documentId: source.source_document_id ?? '',
          chunkId: source.chunk_id ?? '',
          text: source.text ?? '',
          page: source.page ?? null,
          score: typeof hit._score === 'number' ? hit._score : 0,
        };
      });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return [];
      this.logger.error(`search on ${name} failed: ${(error as Error)?.message}`);
      throw this.unavailable('Full-text search is unavailable');
    }
  }

  private requireClient(): OpenSearchClient {
    if (!this.client) {
      throw new ApiError({
        code: HttpErrorCode.SEARCH_UNAVAILABLE,
        status: 503,
        message: 'Full-text search is not configured',
      });
    }
    return this.client;
  }

  private unavailable(message: string): ApiError {
    return new ApiError({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
      message,
    });
  }
}
