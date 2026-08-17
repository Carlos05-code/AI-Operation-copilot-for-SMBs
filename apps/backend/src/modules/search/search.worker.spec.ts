/**
 * Unit tests — SearchWorker (search-jobs consumer).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { StorageService } from '../storage/storage.service';
import { SearchWorker, type DocumentIndexJobData } from './search.worker';
import type { SearchService } from './search.service';

const job = (overrides: Partial<DocumentIndexJobData> = {}): Job<DocumentIndexJobData> =>
  ({
    name: 'document.index',
    data: {
      documentId: 'doc-1',
      organizationId: 'org-1',
      objectKey: 'org-1/doc-1/clean.txt',
      ...overrides,
    },
  }) as unknown as Job<DocumentIndexJobData>;

function harness(
  overrides: {
    storage?: { getObject: jest.Mock };
    search?: { isConfigured: boolean; indexChunks: jest.Mock };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: SearchWorker;
  storage: { getObject: jest.Mock };
  search: { isConfigured: boolean; indexChunks: jest.Mock };
  outbox: { append: jest.Mock };
} {
  const storage = overrides.storage ?? { getObject: jest.fn() };
  const search = overrides.search ?? { isConfigured: true, indexChunks: jest.fn() };
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const worker = new SearchWorker(
    storage as unknown as StorageService,
    search as unknown as SearchService,
    outbox as unknown as OutboxService,
  );
  return { worker, storage, search, outbox };
}

describe('SearchWorker', () => {
  it('skips jobs that are not document.index', async () => {
    const { worker, storage } = harness();
    const foreign = {
      name: 'invoice.processed',
      data: { documentId: 'doc-1', organizationId: 'org-1', objectKey: 'k' },
    } as unknown as Job<DocumentIndexJobData>;
    const result = await worker.process(foreign);
    expect(result).toEqual({ skipped: true });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('skips when opensearch is not configured', async () => {
    const { worker, storage } = harness({
      search: { isConfigured: false, indexChunks: jest.fn() },
    });
    const result = await worker.process(job());
    expect(result).toEqual({ skipped: 'not configured' });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('runs the full pipeline: read, chunk, index, emit', async () => {
    const { worker, storage, search, outbox } = harness();
    storage.getObject.mockResolvedValue(Buffer.from('Hello world. This is a test.'));
    const result = await worker.process(job());
    expect(storage.getObject).toHaveBeenCalledWith('org-1/doc-1/clean.txt');
    expect(search.indexChunks).toHaveBeenCalledWith('org-1', 'doc-1', [
      { index: 0, text: 'Hello world. This is a test.', tokens: 7 },
    ]);
    expect(outbox.append).toHaveBeenCalledWith({
      aggregateType: 'document',
      aggregateId: 'doc-1',
      eventType: 'document.indexed',
      payload: { documentId: 'doc-1', organizationId: 'org-1', chunkCount: 1 },
    });
    expect(result).toEqual({ documentId: 'doc-1', indexedChunks: 1 });
  });

  it('propagates storage failures for BullMQ retries', async () => {
    const { worker, storage } = harness();
    storage.getObject.mockRejectedValue(new Error('no such key'));
    await expect(worker.process(job())).rejects.toThrow('no such key');
  });

  it('propagates indexing failures for BullMQ retries', async () => {
    const { worker, search } = harness();
    storageText(worker, 'Hello world.');
    search.indexChunks.mockRejectedValue(new Error('cluster down'));
    await expect(worker.process(job())).rejects.toThrow('cluster down');
  });

  it('stays successful when the outbox append fails', async () => {
    const { worker, outbox } = harness({
      outbox: { append: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    storageText(worker, 'Hello world.');
    await expect(worker.process(job())).resolves.toEqual({
      documentId: 'doc-1',
      indexedChunks: 1,
    });
    expect(outbox.append).toHaveBeenCalled();
  });
});

function storageText(worker: SearchWorker, text: string): void {
  const storage = (worker as unknown as { storage: { getObject: jest.Mock } }).storage;
  storage.getObject.mockResolvedValue(Buffer.from(text));
}
