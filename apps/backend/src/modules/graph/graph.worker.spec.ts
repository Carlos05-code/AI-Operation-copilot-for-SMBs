/**
 * Unit tests — GraphWorker (graph-jobs consumer).
 */
import type { Job } from 'bullmq';
import type { OutboxService } from '../events/outbox.service';
import type { StorageService } from '../storage/storage.service';
import type { GraphService } from './graph.service';
import { GraphWorker, type DocumentGraphJobData } from './graph.worker';

const job = (overrides: Partial<DocumentGraphJobData> = {}): Job<DocumentGraphJobData> =>
  ({
    name: 'document.graph',
    data: {
      documentId: 'doc-1',
      organizationId: 'org-1',
      objectKey: 'org-1/doc-1/clean.txt',
      ...overrides,
    },
  }) as unknown as Job<DocumentGraphJobData>;

function harness(
  overrides: {
    storage?: { getObject: jest.Mock };
    graph?: { isConfigured: boolean; upsertDocumentChunks: jest.Mock };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: GraphWorker;
  storage: { getObject: jest.Mock };
  graph: { isConfigured: boolean; upsertDocumentChunks: jest.Mock };
  outbox: { append: jest.Mock };
} {
  const storage = overrides.storage ?? { getObject: jest.fn() };
  const graph = overrides.graph ?? { isConfigured: true, upsertDocumentChunks: jest.fn() };
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const worker = new GraphWorker(
    storage as unknown as StorageService,
    graph as unknown as GraphService,
    outbox as unknown as OutboxService,
  );
  return { worker, storage, graph, outbox };
}

describe('GraphWorker', () => {
  it('skips jobs that are not document.graph', async () => {
    const { worker, storage } = harness();
    const foreign = {
      name: 'invoice.processed',
      data: { documentId: 'doc-1', organizationId: 'org-1', objectKey: 'k' },
    } as unknown as Job<DocumentGraphJobData>;
    const result = await worker.process(foreign);
    expect(result).toEqual({ skipped: true });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('skips when neo4j is not configured', async () => {
    const { worker, storage } = harness({
      graph: { isConfigured: false, upsertDocumentChunks: jest.fn() },
    });
    const result = await worker.process(job());
    expect(result).toEqual({ skipped: 'not configured' });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('runs the full pipeline: read, chunk, extract, merge, emit', async () => {
    const { worker, storage, graph, outbox } = harness();
    storage.getObject.mockResolvedValue(Buffer.from('Dr Jane Doe leads Acme Corporation.'));
    const result = await worker.process(job());
    expect(storage.getObject).toHaveBeenCalledWith('org-1/doc-1/clean.txt');
    expect(graph.upsertDocumentChunks).toHaveBeenCalledWith('org-1', 'doc-1', [
      {
        index: 0,
        text: 'Dr Jane Doe leads Acme Corporation.',
        entities: [
          { canonical: 'jane doe', kind: 'person' },
          { canonical: 'acme corporation', kind: 'organization' },
        ],
      },
    ]);
    expect(outbox.append).toHaveBeenCalledWith({
      aggregateType: 'document',
      aggregateId: 'doc-1',
      eventType: 'document.graph_indexed',
      payload: { documentId: 'doc-1', organizationId: 'org-1', chunkCount: 1 },
    });
    expect(result).toEqual({ documentId: 'doc-1', graphChunks: 1 });
  });

  it('propagates storage failures for BullMQ retries', async () => {
    const { worker, storage } = harness();
    storage.getObject.mockRejectedValue(new Error('no such key'));
    await expect(worker.process(job())).rejects.toThrow('no such key');
  });

  it('propagates graph failures for BullMQ retries', async () => {
    const { worker, graph } = harness();
    storageText(worker, 'Acme Corporation announced.');
    graph.upsertDocumentChunks.mockRejectedValue(new Error('connection refused'));
    await expect(worker.process(job())).rejects.toThrow('connection refused');
  });

  it('stays successful when the outbox append fails', async () => {
    const { worker, outbox } = harness({
      outbox: { append: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    storageText(worker, 'Acme Corporation announced.');
    await expect(worker.process(job())).resolves.toEqual({
      documentId: 'doc-1',
      graphChunks: 1,
    });
    expect(outbox.append).toHaveBeenCalled();
  });
});

function storageText(worker: GraphWorker, text: string): void {
  const storage = (worker as unknown as { storage: { getObject: jest.Mock } }).storage;
  storage.getObject.mockResolvedValue(Buffer.from(text));
}
