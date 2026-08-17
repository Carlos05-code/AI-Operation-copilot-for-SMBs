/**
 * Unit tests — EmbeddingsWorker (ai-jobs consumer).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { StorageService } from '../storage/storage.service';
import { EmbeddingProvider } from './embedding.provider';
import { EmbeddingsWorker } from './embeddings.worker';
import type { DocumentIngestedJobData } from './embeddings.worker';
import type { VectorStoreService } from './vector-store.service';

const job = (overrides: Partial<DocumentIngestedJobData> = {}): Job<DocumentIngestedJobData> =>
  ({
    name: 'document.ingested',
    data: {
      documentId: 'doc-1',
      organizationId: 'org-1',
      objectKey: 'org-1/doc-1/clean.txt',
      ...overrides,
    },
  }) as unknown as Job<DocumentIngestedJobData>;

function harness(
  overrides: {
    storage?: { getObject: jest.Mock };
    provider?: { isConfigured: boolean; embed: jest.Mock };
    vectorStore?: { isConfigured: boolean; upsertChunks: jest.Mock };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: EmbeddingsWorker;
  storage: { getObject: jest.Mock };
  provider: { isConfigured: boolean; embed: jest.Mock };
  vectorStore: { isConfigured: boolean; upsertChunks: jest.Mock };
  outbox: { append: jest.Mock };
} {
  const storage = overrides.storage ?? { getObject: jest.fn() };
  const provider = overrides.provider ?? { isConfigured: true, embed: jest.fn() };
  const vectorStore = overrides.vectorStore ?? { isConfigured: true, upsertChunks: jest.fn() };
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const worker = new EmbeddingsWorker(
    storage as unknown as StorageService,
    provider as unknown as EmbeddingProvider,
    vectorStore as unknown as VectorStoreService,
    outbox as unknown as OutboxService,
  );
  return { worker, storage, provider, vectorStore, outbox };
}

describe('EmbeddingsWorker', () => {
  it('skips jobs that are not document.ingested', async () => {
    const { worker, storage } = harness();
    const foreign = {
      name: 'invoice.processed',
      data: { documentId: 'doc-1', organizationId: 'org-1', objectKey: 'k' },
    } as unknown as Job<DocumentIngestedJobData>;
    const result = await worker.process(foreign);
    expect(result).toEqual({ skipped: true });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('skips when embeddings or qdrant are not configured', async () => {
    const { worker, storage } = harness({
      provider: { isConfigured: false, embed: jest.fn() },
    });
    const result = await worker.process(job());
    expect(result).toEqual({ skipped: 'not configured' });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('runs the full pipeline: read, chunk, embed, upsert, emit', async () => {
    const { worker, storage, provider, vectorStore, outbox } = harness();
    storage.getObject.mockResolvedValue(Buffer.from('Hello world. This is a test.'));
    provider.embed.mockResolvedValue([[0.1, 0.2]]);
    const result = await worker.process(job());
    expect(storage.getObject).toHaveBeenCalledWith('org-1/doc-1/clean.txt');
    expect(provider.embed).toHaveBeenCalledWith(['Hello world. This is a test.']);
    expect(vectorStore.upsertChunks).toHaveBeenCalledWith('org-1', 'doc-1', [
      { text: 'Hello world. This is a test.', vector: [0.1, 0.2], index: 0 },
    ]);
    expect(outbox.append).toHaveBeenCalledWith({
      aggregateType: 'document',
      aggregateId: 'doc-1',
      eventType: 'document.embedded',
      payload: { documentId: 'doc-1', organizationId: 'org-1', chunkCount: 1 },
    });
    expect(result).toEqual({ documentId: 'doc-1', embeddedChunks: 1 });
  });

  it('embeds in batches of EMBEDDING_BATCH_SIZE', async () => {
    const { worker, provider } = harness();
    const oversized = Array.from({ length: 65 }, (_, i) => `${'word '.repeat(500)}${i}.`).join(' ');
    storageText(worker, oversized);
    provider.embed.mockImplementation((batch: string[]) => batch.map(() => [0.5]));
    await worker.process(job());
    expect(provider.embed).toHaveBeenCalledTimes(2);
    const firstBatch = provider.embed.mock.calls[0]?.[0] as string[] | undefined;
    const secondBatch = provider.embed.mock.calls[1]?.[0] as string[] | undefined;
    expect(firstBatch?.length).toBe(64);
    expect(secondBatch?.length).toBe(1);
  });

  it('propagates storage failures for BullMQ retries', async () => {
    const { worker, storage } = harness();
    storage.getObject.mockRejectedValue(new Error('no such key'));
    await expect(worker.process(job())).rejects.toThrow('no such key');
  });

  it('propagates embedding failures for BullMQ retries', async () => {
    const { worker, provider } = harness();
    storageText(worker, 'Hello world.');
    provider.embed.mockRejectedValue(new Error('api down'));
    await expect(worker.process(job())).rejects.toThrow('api down');
  });

  it('stays successful when the outbox append fails', async () => {
    const { worker, outbox, provider } = harness({
      outbox: { append: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    storageText(worker, 'Hello world.');
    provider.embed.mockResolvedValue([[0.1]]);
    await expect(worker.process(job())).resolves.toEqual({
      documentId: 'doc-1',
      embeddedChunks: 1,
    });
    expect(outbox.append).toHaveBeenCalled();
  });
});

function storageText(worker: EmbeddingsWorker, text: string): void {
  const storage = (worker as unknown as { storage: { getObject: jest.Mock } }).storage;
  storage.getObject.mockResolvedValue(Buffer.from(text));
}
