/**
 * Unit tests — KnowledgeService (org-scoped KB surface).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from './knowledge.service';

function harness(
  overrides: {
    prisma?: {
      knowledgeDocument?: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock };
    };
  } = {},
): {
  service: KnowledgeService;
  prisma: { knowledgeDocument: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock } };
} {
  const knowledgeDocument = overrides.prisma?.knowledgeDocument ?? {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
  };
  const prisma = { knowledgeDocument } as unknown as PrismaService;
  return { service: new KnowledgeService(prisma), prisma: { knowledgeDocument } };
}

const entry = { id: 'kb-1', organizationId: 'org-1', documentId: 'doc-1' };

describe('KnowledgeService', () => {
  it('lists the org entries newest first with pagination math', async () => {
    const { service, prisma } = harness();
    prisma.knowledgeDocument.findMany.mockResolvedValue([entry]);
    prisma.knowledgeDocument.count.mockResolvedValue(41);
    const result = await service.list('org-1', 3, 20);
    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
        skip: 40,
        take: 20,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(41);
    expect(result.page).toBe(3);
    expect(result.limit).toBe(20);
    expect(result.pages).toBe(3);
  });

  it('reports at least one page when the org has no entries', async () => {
    const { service, prisma } = harness();
    prisma.knowledgeDocument.findMany.mockResolvedValue([]);
    prisma.knowledgeDocument.count.mockResolvedValue(0);
    const result = await service.list('org-1');
    expect(result.items).toEqual([]);
    expect(result.pages).toBe(1);
  });

  it('returns 404 for a foreign or absent entry', async () => {
    const { service, prisma } = harness();
    prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'kb-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'kb-1', organizationId: 'org-2' } }),
    );
  });

  it('returns an org-scoped entry', async () => {
    const { service, prisma } = harness();
    prisma.knowledgeDocument.findFirst.mockResolvedValue(entry);
    await expect(service.get('org-1', 'kb-1')).resolves.toMatchObject({ id: 'kb-1' });
  });

  it('fails with a contract error when the database is not configured', async () => {
    const service = new KnowledgeService(undefined);
    await expect(service.list('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
