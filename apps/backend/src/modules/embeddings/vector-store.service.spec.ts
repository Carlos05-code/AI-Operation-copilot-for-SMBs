/**
 * Unit tests — VectorStoreService (Qdrant wrapper).
 */
import type { QdrantClient } from '@qdrant/js-client-rest';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import {
  conversationMessagePointId,
  chunkPointId,
  VectorStoreService,
} from './vector-store.service';

function mockQdrant(): {
  getCollections: jest.Mock;
  createCollection: jest.Mock;
  createPayloadIndex: jest.Mock;
  upsert: jest.Mock;
  query: jest.Mock;
} {
  return {
    getCollections: jest.fn(),
    createCollection: jest.fn(),
    createPayloadIndex: jest.fn(),
    upsert: jest.fn(),
    query: jest.fn(),
  };
}

function service(client: ReturnType<typeof mockQdrant>): VectorStoreService {
  return new VectorStoreService(client as unknown as QdrantClient, 1024);
}

describe('VectorStoreService', () => {
  it('reports isConfigured only with a client', () => {
    expect(service(mockQdrant()).isConfigured).toBe(true);
    expect(new VectorStoreService(undefined).isConfigured).toBe(false);
  });

  it('names collections with the org namespace pattern', () => {
    expect(service(mockQdrant()).collectionName('org-1')).toBe('doc_chunks_org-1');
    expect(service(mockQdrant()).conversationCollectionName('org-1')).toBe('conversation_org-1');
  });

  it('creates a missing conversation collection with indexes', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'other' }] });
    const name = await service(client).ensureConversationCollection('org-1');
    expect(name).toBe('conversation_org-1');
    expect(client.createCollection).toHaveBeenCalledWith('conversation_org-1', {
      vectors: { size: 1024, distance: 'Cosine' },
    });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('conversation_org-1', {
      field_name: 'org_id',
      field_schema: 'keyword',
    });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('conversation_org-1', {
      field_name: 'conversation_id',
      field_schema: 'keyword',
    });
  });

  it('upserts conversation messages with deterministic ids and payload', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'conversation_org-1' }] });
    client.upsert.mockResolvedValue({ status: 'completed' });
    const store = service(client);
    const sentAt = new Date('2026-08-19T10:00:00Z');
    await store.upsertConversationMessages('org-1', 'conv-1', 'cust-1', 'WHATSAPP', [
      {
        messageId: 'msg-1',
        sender: 'CUSTOMER',
        body: 'Hello',
        sentAt,
        vector: [0.1, 0.2],
      },
    ]);
    expect(client.upsert).toHaveBeenCalledWith('conversation_org-1', {
      wait: true,
      points: [
        {
          id: conversationMessagePointId('conv-1', 'msg-1'),
          vector: [0.1, 0.2],
          payload: {
            org_id: 'org-1',
            conversation_id: 'conv-1',
            customer_id: 'cust-1',
            channel: 'WHATSAPP',
            sender: 'CUSTOMER',
            message_id: 'msg-1',
            sent_at: sentAt.getTime(),
            text: 'Hello',
          },
        },
      ],
    });
  });

  it('skips the upsert with no messages', async () => {
    const client = mockQdrant();
    await service(client).upsertConversationMessages('org-1', 'conv-1', null, 'EMAIL', []);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('maps conversation upsert failures to VECTOR_STORE_UNAVAILABLE', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'conversation_org-1' }] });
    client.upsert.mockRejectedValue(new Error('connection refused'));
    await expect(
      service(client).upsertConversationMessages('org-1', 'conv-1', null, 'SLACK', [
        { messageId: 'msg-1', sender: 'AGENT', body: 'x', sentAt: new Date(), vector: [1] },
      ]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
  });

  it('creates a missing collection with indexes', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'other' }] });
    const name = await service(client).ensureCollection('org-1');
    expect(name).toBe('doc_chunks_org-1');
    expect(client.createCollection).toHaveBeenCalledWith('doc_chunks_org-1', {
      vectors: { size: 1024, distance: 'Cosine' },
    });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('doc_chunks_org-1', {
      field_name: 'org_id',
      field_schema: 'keyword',
    });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('doc_chunks_org-1', {
      field_name: 'source_document_id',
      field_schema: 'keyword',
    });
  });

  it('reuses an existing collection', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'doc_chunks_org-1' }] });
    await service(client).ensureCollection('org-1');
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('maps collection failures to VECTOR_STORE_UNAVAILABLE', async () => {
    const client = mockQdrant();
    client.getCollections.mockRejectedValue(new Error('connection refused'));
    await expect(service(client).ensureCollection('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
  });

  it('throws VECTOR_STORE_UNAVAILABLE when not configured', async () => {
    const store = new VectorStoreService(undefined);
    await expect(store.ensureCollection('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
    await expect(
      store.upsertChunks('org-1', 'doc-1', [{ text: 'x', vector: [1], index: 0 }]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
  });

  it('skips empty upserts', async () => {
    const client = mockQdrant();
    await service(client).upsertChunks('org-1', 'doc-1', []);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('upserts deterministic points with document payload', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [] });
    await service(client).upsertChunks('org-1', 'doc-1', [
      { text: 'first chunk', vector: [0.1, 0.2], index: 0 },
      { text: 'second chunk', vector: [0.3, 0.4], index: 1 },
    ]);
    expect(client.upsert).toHaveBeenCalledWith('doc_chunks_org-1', {
      wait: true,
      points: [
        {
          id: chunkPointId('doc-1', 0),
          vector: [0.1, 0.2],
          payload: {
            source_document_id: 'doc-1',
            org_id: 'org-1',
            chunk_id: 'doc-1:0',
            page: null,
            text: 'first chunk',
          },
        },
        {
          id: chunkPointId('doc-1', 1),
          vector: [0.3, 0.4],
          payload: {
            source_document_id: 'doc-1',
            org_id: 'org-1',
            chunk_id: 'doc-1:1',
            page: null,
            text: 'second chunk',
          },
        },
      ],
    });
  });

  it('maps upsert failures to VECTOR_STORE_UNAVAILABLE', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [] });
    client.upsert.mockRejectedValue(new Error('disk full'));
    await expect(
      service(client).upsertChunks('org-1', 'doc-1', [{ text: 'x', vector: [1], index: 0 }]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
  });

  it('returns no results when the org collection does not exist', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({ collections: [] });
    const hits = await service(client).searchSimilar('org-1', [0.1]);
    expect(hits).toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('maps search hits from payload into store-agnostic results', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({
      collections: [{ name: 'doc_chunks_org-1' }],
    });
    client.query.mockResolvedValue({
      points: [
        {
          score: 0.87,
          payload: {
            source_document_id: 'doc-1',
            chunk_id: 'doc-1:3',
            page: null,
            text: 'the matching chunk',
          },
        },
      ],
    });
    const hits = await service(client).searchSimilar('org-1', [0.1, 0.2], 5);
    expect(client.query).toHaveBeenCalledWith('doc_chunks_org-1', {
      query: [0.1, 0.2],
      limit: 5,
      with_payload: true,
    });
    expect(hits).toEqual([
      {
        documentId: 'doc-1',
        chunkId: 'doc-1:3',
        text: 'the matching chunk',
        page: null,
        score: 0.87,
      },
    ]);
  });

  it('maps search failures to VECTOR_STORE_UNAVAILABLE', async () => {
    const client = mockQdrant();
    client.getCollections.mockResolvedValue({
      collections: [{ name: 'doc_chunks_org-1' }],
    });
    client.query.mockRejectedValue(new Error('connection refused'));
    await expect(service(client).searchSimilar('org-1', [0.1])).rejects.toMatchObject({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
    });
  });
});

describe('chunkPointId', () => {
  it('is deterministic and distinct per index', () => {
    expect(chunkPointId('doc-1', 0)).toBe(chunkPointId('doc-1', 0));
    expect(chunkPointId('doc-1', 0)).not.toBe(chunkPointId('doc-1', 1));
    expect(chunkPointId('doc-1', 0)).toMatch(/^[0-9a-f]{40}$/);
  });
});
