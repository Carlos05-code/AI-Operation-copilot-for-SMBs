/**
 * HybridSearchService: fuses vector (Qdrant) and keyword (OpenSearch) results
 * with Reciprocal Rank Fusion (AI_ARCHITECTURE §5, ADR-0006/0012).
 *
 * Each configured store contributes its top-k candidates; scores from
 * different stores are incomparable, so fusion ranks by position
 * (`1/(k + rank)`). A store that is unconfigured or failing contributes
 * nothing: the request degrades gracefully to whatever is available and only
 * fails with `SEARCH_UNAVAILABLE` (503) when no store could be queried.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { EmbeddingProvider } from '../embeddings/embedding.provider';
import { VectorStoreService } from '../embeddings/vector-store.service';
import { DEFAULT_SEARCH_LIMIT, RRF_K, SEARCH_CANDIDATES } from './search.constants';
import { SearchHit, SearchService } from './search.service';

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStoreService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * Hybrid search over the org knowledge base. Results are ranked by fused
   * RRF score; `null`-returning stores (failed at query time) are skipped.
   */
  async search(
    organizationId: string,
    query: string,
    limit: number = DEFAULT_SEARCH_LIMIT,
  ): Promise<SearchHit[]> {
    const candidates = SEARCH_CANDIDATES;
    const runs: Array<Promise<SearchHit[] | null>> = [];
    if (this.vectorStore.isConfigured && this.provider.isConfigured) {
      runs.push(this.tryRun(() => this.vectorSearch(organizationId, query, candidates)));
    }
    if (this.searchService.isConfigured) {
      runs.push(
        this.tryRun(() => this.searchService.searchFullText(organizationId, query, candidates)),
      );
    }
    if (runs.length === 0) {
      throw new ApiError({
        code: HttpErrorCode.SEARCH_UNAVAILABLE,
        status: 503,
        message: 'Search is not configured',
      });
    }

    const lists = (await Promise.all(runs)).filter(
      (results): results is SearchHit[] => results !== null,
    );
    if (lists.length === 0) {
      throw new ApiError({
        code: HttpErrorCode.SEARCH_UNAVAILABLE,
        status: 503,
        message: 'Search is unavailable',
      });
    }
    if (lists.length < runs.length) {
      this.logger.warn(`search degraded: ${runs.length - lists.length} store(s) unavailable`);
    }
    return fuse(lists, limit);
  }

  private async vectorSearch(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<SearchHit[]> {
    const [vector] = await this.provider.embed([query]);
    return this.vectorStore.searchSimilar(organizationId, vector, limit);
  }

  private async tryRun(run: () => Promise<SearchHit[]>): Promise<SearchHit[] | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`search store query failed: ${(error as Error)?.message}`);
      return null;
    }
  }
}

/**
 * Reciprocal Rank Fusion: merges ranked lists by position, ignoring the
 * (incomparable) raw scores from each store.
 */
function fuse(lists: SearchHit[][], limit: number): SearchHit[] {
  const fused = new Map<string, { hit: SearchHit; score: number }>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const key = `${hit.documentId}:${hit.chunkId}`;
      const contribution = 1 / (RRF_K + index + 1);
      const entry = fused.get(key);
      if (entry) {
        entry.score += contribution;
      } else {
        fused.set(key, { hit, score: contribution });
      }
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, score: entry.score }));
}
