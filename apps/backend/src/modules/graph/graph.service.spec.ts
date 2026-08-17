/**
 * Unit tests — GraphService (Neo4j wrapper).
 */
import type { Driver } from 'neo4j-driver';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { chunkPointId } from '../embeddings/vector-store.service';
import { GraphService } from './graph.service';

function mockSession(): {
  executeWrite: jest.Mock;
  executeRead: jest.Mock;
  close: jest.Mock;
} {
  return { executeWrite: jest.fn(), executeRead: jest.fn(), close: jest.fn() };
}

function mockDriver(session: ReturnType<typeof mockSession> = mockSession()): {
  session: jest.Mock;
} {
  return { session: jest.fn(() => session) };
}

function service(driver: ReturnType<typeof mockDriver> = mockDriver()): GraphService {
  return new GraphService(driver as unknown as Driver, undefined);
}

describe('GraphService', () => {
  it('reports isConfigured only with a driver', () => {
    expect(service().isConfigured).toBe(true);
    expect(new GraphService(undefined, undefined).isConfigured).toBe(false);
  });

  it('merges document, chunks, and entities with deterministic ids', async () => {
    const session = mockSession();
    const run = jest.fn().mockResolvedValue({});
    session.executeWrite.mockImplementation((work: (tx: { run: jest.Mock }) => Promise<unknown>) =>
      work({ run }),
    );
    await service(mockDriver(session)).upsertDocumentChunks('org-1', 'doc-1', [
      {
        index: 0,
        text: 'Acme Corporation announced a new policy.',
        entities: [{ canonical: 'acme corporation', kind: 'organization' }],
      },
      { index: 1, text: 'No entities here.', entities: [] },
    ]);
    expect(session.executeWrite).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.stringContaining('UNWIND $rows AS row'), {
      rows: [
        {
          document_id: 'doc-1',
          organization_id: 'org-1',
          chunk_id: chunkPointId('doc-1', 0),
          index: 0,
          text: 'Acme Corporation announced a new policy.',
          entities: [{ canonical: 'acme corporation', kind: 'organization' }],
        },
        {
          document_id: 'doc-1',
          organization_id: 'org-1',
          chunk_id: chunkPointId('doc-1', 1),
          index: 1,
          text: 'No entities here.',
          entities: [],
        },
      ],
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('skips empty chunk batches', async () => {
    const session = mockSession();
    await service(mockDriver(session)).upsertDocumentChunks('org-1', 'doc-1', []);
    expect(session.executeWrite).not.toHaveBeenCalled();
  });

  it('maps upsert failures to GRAPH_UNAVAILABLE', async () => {
    const session = mockSession();
    session.executeWrite.mockRejectedValue(new Error('connection refused'));
    await expect(
      service(mockDriver(session)).upsertDocumentChunks('org-1', 'doc-1', [
        { index: 0, text: 'x', entities: [] },
      ]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.GRAPH_UNAVAILABLE,
      status: 503,
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('returns no results without query entities', async () => {
    const session = mockSession();
    await expect(service(mockDriver(session)).searchByEntities('org-1', [], 10)).resolves.toEqual(
      [],
    );
    expect(session.executeRead).not.toHaveBeenCalled();
  });

  it('returns chunks mentioning query entities with match scores', async () => {
    const session = mockSession();
    const record = (values: Record<string, unknown>) => ({
      get: (key: string) => values[key],
    });
    session.executeRead.mockImplementation((work: (tx: { run: jest.Mock }) => Promise<unknown>) =>
      work({
        run: jest.fn().mockResolvedValue({
          records: [
            record({
              chunk_id: chunkPointId('doc-1', 2),
              document_id: 'doc-1',
              text: 'x',
              score: 2,
            }),
            record({
              chunk_id: chunkPointId('doc-2', 0),
              document_id: 'doc-2',
              text: 'y',
              score: 1,
            }),
          ],
        }),
      }),
    );
    const service = new GraphService(mockDriver(session) as unknown as Driver, undefined);
    const hits = await service.searchByEntities('org-1', ['acme corporation'], 5);
    expect(session.executeRead).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([
      { documentId: 'doc-1', chunkId: chunkPointId('doc-1', 2), text: 'x', page: null, score: 2 },
      { documentId: 'doc-2', chunkId: chunkPointId('doc-2', 0), text: 'y', page: null, score: 1 },
    ]);
  });

  it('maps search failures to GRAPH_UNAVAILABLE', async () => {
    const session = mockSession();
    session.executeRead.mockRejectedValue(new Error('database unreachable'));
    await expect(
      service(mockDriver(session)).searchByEntities('org-1', ['acme'], 5),
    ).rejects.toMatchObject({
      code: HttpErrorCode.GRAPH_UNAVAILABLE,
      status: 503,
    });
  });

  it('throws GRAPH_UNAVAILABLE when not configured', async () => {
    const graph = new GraphService(undefined, undefined);
    await expect(
      graph.upsertDocumentChunks('org-1', 'doc-1', [{ index: 0, text: 'x', entities: [] }]),
    ).rejects.toMatchObject({
      code: HttpErrorCode.GRAPH_UNAVAILABLE,
      status: 503,
    });
    await expect(graph.searchByEntities('org-1', ['acme'], 5)).rejects.toMatchObject({
      code: HttpErrorCode.GRAPH_UNAVAILABLE,
      status: 503,
    });
  });
});
