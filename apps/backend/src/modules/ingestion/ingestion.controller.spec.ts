/**
 * Unit tests — IngestionController guards and delegation.
 */
import { IngestionController } from './ingestion.controller';
import type { AuthContext } from '../auth/auth.types';

const user: AuthContext = { userId: 'u1', organizationId: 'org-1', role: 'AGENT' };

describe('IngestionController', () => {
  it('delegates document creation with the org from claims', async () => {
    const ingestion = { create: jest.fn().mockResolvedValue({ id: 'doc-1' }) };
    const controller = new IngestionController(ingestion as never);
    const result = await controller.create(user, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'org-1/k',
    });
    expect(ingestion.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'org-1/k',
    });
    expect(result.id).toBe('doc-1');
  });

  it('delegates ingest with org scoping', async () => {
    const ingestion = { ingest: jest.fn().mockResolvedValue({ id: 'doc-1', status: 'INDEXED' }) };
    const controller = new IngestionController(ingestion as never);
    await controller.ingest(user, 'doc-1');
    expect(ingestion.ingest).toHaveBeenCalledWith('org-1', 'doc-1');
  });

  it('delegates fetches with org scoping', async () => {
    const ingestion = { get: jest.fn().mockResolvedValue({ id: 'doc-1' }) };
    const controller = new IngestionController(ingestion as never);
    await controller.get(user, 'doc-1');
    expect(ingestion.get).toHaveBeenCalledWith('org-1', 'doc-1');
  });

  it('rejects tokens without an organization claim', async () => {
    const controller = new IngestionController({ create: jest.fn() } as never);
    await expect(
      controller.create(
        { userId: 'u1' },
        {
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          storageKey: 'org-1/k',
        },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
