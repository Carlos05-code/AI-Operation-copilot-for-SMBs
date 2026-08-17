/**
 * Unit tests — HybridSearchService (RRF fusion + graceful degradation).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { EmbeddingProvider } from '../embeddings/embedding.provider';
import type { VectorStoreService } from '../embeddings/vector-store.service';
import { HybridSearchService } from './hybrid-search.service';
import type { SearchService } from './search.service';

function harness(
  overrides: {
    provider?: { isConfigured: boolean; embed: jest.Mock };
    vectorStore?: { isConfigured: boolean; searchSimilar: jest.Mock };
    search?: { isConfigured: boolean; searchFullText: jest.Mock };
  } = {},
): {
  hybrid: HybridSearchService;
  provider: { isConfigured: boolean; embed: jest.Mock };
  vectorStore: { isConfigured: boolean; searchSimilar: jest.Mock };
  search: { isConfigured: boolean; searchFullText: jest.Mock };
} {
  const provider = overrides.provider ?? { isConfigured: true, embed: jest.fn() };
  const vectorStore = overrides.vectorStore ?? { isConfigured: true, searchSimilar: jest.fn() };
  const search = overrides.search ?? { isConfigured: true, searchFullText: jest.fn() };
  const hybrid = new HybridSearchService(
    provider as unknown as EmbeddingProvider,
    vectorStore as unknown as VectorStoreService,
    search as unknown as SearchService,
  );
  return { hybrid, provider, vectorStore, search };
}

const hit = (documentId: string, chunkId: string, score: number) => ({
  documentId,
  chunkId,
  text: `${documentId} ${chunkId}`,
  page: null,
  score,
});

describe('HybridSearchService', () => {
  it('throws SEARCH_UNAVAILABLE when nothing is configured', async () => {
    const { hybrid } = harness({
      provider: { isConfigured: false, embed: jest.fn() },
      vectorStore: { isConfigured: false, searchSimilar: jest.fn() },
      search: { isConfigured: false, searchFullText: jest.fn() },
    });
    await expect(hybrid.search('org-1', 'hello')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });

  it('embeds the query and asks both stores for candidates', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockResolvedValue([[0.1, 0.2]]);
    vectorStore.searchSimilar.mockResolvedValue([]);
    search.searchFullText.mockResolvedValue([]);
    await hybrid.search('org-1', 'the query', 10);
    expect(provider.embed).toHaveBeenCalledWith(['the query']);
    expect(vectorStore.searchSimilar).toHaveBeenCalledWith('org-1', [0.1, 0.2], 20);
    expect(search.searchFullText).toHaveBeenCalledWith('org-1', 'the query', 20);
  });

  it('fuses ranked lists with RRF, ranking shared hits first', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockResolvedValue([[0.5]]);
    vectorStore.searchSimilar.mockResolvedValue([
      hit('doc-1', 'doc-1:0', 0.9),
      hit('doc-1', 'doc-1:1', 0.8),
    ]);
    search.searchFullText.mockResolvedValue([
      hit('doc-1', 'doc-1:1', 7.5),
      hit('doc-2', 'doc-2:3', 6.0),
    ]);
    const results = await hybrid.search('org-1', 'the query');
    expect(results.map((r) => r.chunkId)).toEqual(['doc-1:1', 'doc-1:0', 'doc-2:3']);
    expect(results[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(results[1]?.score).toBeCloseTo(1 / 61);
  });

  it('applies the requested limit after fusion', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockResolvedValue([[0.5]]);
    vectorStore.searchSimilar.mockResolvedValue([
      hit('doc-1', 'doc-1:0', 0.9),
      hit('doc-1', 'doc-1:1', 0.8),
    ]);
    search.searchFullText.mockResolvedValue([]);
    const results = await hybrid.search('org-1', 'the query', 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe('doc-1:0');
  });

  it('degrades to vector-only when the keyword store fails', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockResolvedValue([[0.5]]);
    vectorStore.searchSimilar.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.9)]);
    search.searchFullText.mockRejectedValue(new Error('cluster down'));
    const results = await hybrid.search('org-1', 'the query');
    expect(results.map((r) => r.chunkId)).toEqual(['doc-1:0']);
  });

  it('degrades to keyword-only when embedding fails', async () => {
    const { hybrid, provider, search } = harness();
    provider.embed.mockRejectedValue(new Error('api down'));
    search.searchFullText.mockResolvedValue([hit('doc-2', 'doc-2:3', 6.0)]);
    const results = await hybrid.search('org-1', 'the query');
    expect(results.map((r) => r.chunkId)).toEqual(['doc-2:3']);
  });

  it('fails when every configured store failed at query time', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockRejectedValue(new Error('api down'));
    vectorStore.searchSimilar.mockRejectedValue(new Error('qdrant down'));
    search.searchFullText.mockRejectedValue(new Error('cluster down'));
    await expect(hybrid.search('org-1', 'the query')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });

  it('returns an empty list for a real no-match search', async () => {
    const { hybrid, provider, vectorStore, search } = harness();
    provider.embed.mockResolvedValue([[0.5]]);
    vectorStore.searchSimilar.mockResolvedValue([]);
    search.searchFullText.mockResolvedValue([]);
    await expect(hybrid.search('org-1', 'zzz')).resolves.toEqual([]);
  });
});
