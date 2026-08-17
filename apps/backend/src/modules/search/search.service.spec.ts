/**
 * Unit tests — SearchService (OpenSearch wrapper).
 */
import type { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { chunkPointId } from '../embeddings/vector-store.service';
import { SearchService } from './search.service';

function mockClient(): {
  indices: { exists: jest.Mock; create: jest.Mock };
  bulk: jest.Mock;
  search: jest.Mock;
} {
  return {
    indices: { exists: jest.fn(), create: jest.fn() },
    bulk: jest.fn(),
    search: jest.fn(),
  };
}

function service(client: ReturnType<typeof mockClient>): SearchService {
  return new SearchService(client as unknown as OpenSearchClient);
}

const INDEX_MAPPINGS = {
  mappings: {
    properties: {
      text: { type: 'text' },
      org_id: { type: 'keyword' },
      source_document_id: { type: 'keyword' },
      chunk_id: { type: 'keyword' },
      page: { type: 'integer' },
    },
  },
};

describe('SearchService', () => {
  it('reports isConfigured only with a client', () => {
    expect(service(mockClient()).isConfigured).toBe(true);
    expect(new SearchService(undefined).isConfigured).toBe(false);
  });

  it('names indices with the org namespace pattern', () => {
    expect(service(mockClient()).indexName('org-1')).toBe('search_org-1');
  });

  it('creates a missing index with chunk mappings', async () => {
    const client = mockClient();
    client.indices.exists.mockResolvedValue({ body: false });
    const name = await service(client).ensureIndex('org-1');
    expect(name).toBe('search_org-1');
    expect(client.indices.create).toHaveBeenCalledWith({
      index: 'search_org-1',
      body: INDEX_MAPPINGS,
    });
  });

  it('reuses an existing index', async () => {
    const client = mockClient();
    client.indices.exists.mockResolvedValue({ body: true });
    await service(client).ensureIndex('org-1');
    expect(client.indices.create).not.toHaveBeenCalled();
  });

  it('maps index failures to SEARCH_UNAVAILABLE', async () => {
    const client = mockClient();
    client.indices.exists.mockRejectedValue(new Error('connection refused'));
    await expect(service(client).ensureIndex('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });

  it('bulk-indexes chunks with deterministic document ids', async () => {
    const client = mockClient();
    client.indices.exists.mockResolvedValue({ body: true });
    client.bulk.mockResolvedValue({ body: { errors: false, items: [] } });
    await service(client).indexChunks('org-1', 'doc-1', [
      { index: 0, text: 'first chunk' },
      { index: 1, text: 'second chunk' },
    ]);
    expect(client.bulk).toHaveBeenCalledWith({
      body: [
        { index: { _index: 'search_org-1', _id: chunkPointId('doc-1', 0) } },
        {
          source: {
            org_id: 'org-1',
            source_document_id: 'doc-1',
            chunk_id: 'doc-1:0',
            page: null,
            text: 'first chunk',
          },
        },
        { index: { _index: 'search_org-1', _id: chunkPointId('doc-1', 1) } },
        {
          source: {
            org_id: 'org-1',
            source_document_id: 'doc-1',
            chunk_id: 'doc-1:1',
            page: null,
            text: 'second chunk',
          },
        },
      ],
    });
  });

  it('skips empty indexing batches', async () => {
    const client = mockClient();
    await service(client).indexChunks('org-1', 'doc-1', []);
    expect(client.bulk).not.toHaveBeenCalled();
  });

  it('maps bulk errors to SEARCH_UNAVAILABLE', async () => {
    const client = mockClient();
    client.indices.exists.mockResolvedValue({ body: true });
    client.bulk.mockResolvedValue({
      body: { errors: true, items: [{ index: { error: { reason: 'mapper rejected' } } }] },
    });
    await expect(
      service(client).indexChunks('org-1', 'doc-1', [{ index: 0, text: 'x' }]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });

  it('searches with an org filter and maps hits', async () => {
    const client = mockClient();
    client.search.mockResolvedValue({
      body: {
        hits: {
          hits: [
            {
              _score: 1.2,
              _source: {
                org_id: 'org-1',
                source_document_id: 'doc-1',
                chunk_id: 'doc-1:2',
                page: null,
                text: 'the matching chunk',
              },
            },
          ],
        },
      },
    });
    const hits = await service(client).searchFullText('org-1', 'matching', 5);
    expect(client.search).toHaveBeenCalledWith({
      index: 'search_org-1',
      size: 5,
      body: {
        query: {
          bool: {
            filter: [{ term: { org_id: 'org-1' } }],
            must: [{ multi_match: { query: 'matching', fields: ['text'] } }],
          },
        },
      },
    });
    expect(hits).toEqual([
      {
        documentId: 'doc-1',
        chunkId: 'doc-1:2',
        text: 'the matching chunk',
        page: null,
        score: 1.2,
      },
    ]);
  });

  it('returns no results when the org index does not exist', async () => {
    const client = mockClient();
    client.search.mockRejectedValue(
      Object.assign(new Error('index_not_found_exception'), { statusCode: 404 }),
    );
    await expect(service(client).searchFullText('org-1', 'x')).resolves.toEqual([]);
  });

  it('maps search failures to SEARCH_UNAVAILABLE', async () => {
    const client = mockClient();
    client.search.mockRejectedValue(new Error('connection refused'));
    await expect(service(client).searchFullText('org-1', 'x')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });

  it('throws SEARCH_UNAVAILABLE when not configured', async () => {
    const search = new SearchService(undefined);
    await expect(search.searchFullText('org-1', 'x')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });
});
