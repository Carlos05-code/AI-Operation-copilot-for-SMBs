/**
 * Unit tests — ingestion pipeline orchestration.
 */
import type { Document, Prisma } from '@prisma/client';
import { IngestionService } from './ingestion.service';
import { ApiError } from '../../shared/errors/error-contract';
import type { TextExtractionService } from './extraction.service';
import type { PrismaService } from '../database/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { OutboxService } from '../events/outbox.service';
import type { QueueService } from '../queue/queue.service';

const document: Document = {
  id: 'doc-1',
  organizationId: 'org-1',
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 'org-1/uuid',
  cleanTextKey: null,
  status: 'PENDING',
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
};

type PrismaDocumentMock = {
  document: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  knowledgeDocument: { upsert: jest.Mock };
  $transaction: jest.Mock;
};

function prismaMock(rows: Document[]): PrismaDocumentMock {
  const findFirst = jest.fn((args: { where: { id?: string; organizationId?: string } }) => {
    const row = rows.find(
      (r) =>
        r.id === args.where.id &&
        (args.where.organizationId === undefined || r.organizationId === args.where.organizationId),
    );
    return row ?? null;
  });
  const update = jest.fn((args: { where: { id: string }; data: Partial<Document> }) => {
    const row = rows.find((r) => r.id === args.where.id);
    return row ? { ...row, ...args.data } : undefined;
  });
  const upsert = jest.fn();
  const create = jest.fn((args: { data: Prisma.DocumentCreateInput }) => ({
    id: 'doc-new',
    ...args.data,
    cleanTextKey: null,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  return {
    document: { findFirst, create, update },
    knowledgeDocument: { upsert },
    $transaction: jest.fn((fn: (tx: never) => Promise<Document>) => {
      const tx = { document: { update }, knowledgeDocument: { upsert } };
      return fn(tx as never);
    }),
  };
}

const storage = { getObject: jest.fn(), putObject: jest.fn() };
const outbox = { append: jest.fn() };
const queue = { enqueue: jest.fn() };
const extractor = { extract: jest.fn() };

function service(overrides?: {
  prisma?: PrismaDocumentMock;
  storage?: typeof storage;
  outbox?: typeof outbox;
  queue?: typeof queue;
  extractor?: typeof extractor;
}): IngestionService {
  const prisma = overrides && 'prisma' in overrides ? overrides.prisma : prismaMock([document]);
  return new IngestionService(
    prisma as unknown as PrismaService,
    (overrides?.storage ?? storage) as unknown as StorageService,
    (overrides?.outbox ?? outbox) as unknown as OutboxService,
    (overrides?.queue ?? queue) as unknown as QueueService,
    (overrides?.extractor ?? extractor) as unknown as TextExtractionService,
  );
}

describe('IngestionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.getObject.mockResolvedValue(Buffer.from('%PDF-'));
    storage.putObject.mockResolvedValue(undefined);
    outbox.append.mockResolvedValue(undefined);
    queue.enqueue.mockResolvedValue('job-1');
    extractor.extract.mockResolvedValue({ text: 'hello\n1\nworld', pageCount: 1 });
  });

  describe('create', () => {
    it('registers a PENDING document row', async () => {
      const prisma = prismaMock([]);
      const result = await service({ prisma }).create({
        organizationId: 'org-1',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        storageKey: 'org-1/k',
      });
      expect(result.id).toBe('doc-new');
      expect(result.status).toBe('PENDING');
      expect(prisma.document.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          storageKey: 'org-1/k',
        },
      });
    });
  });

  describe('get', () => {
    it('returns the document when org-scoped', async () => {
      await expect(service().get('org-1', 'doc-1')).resolves.toMatchObject({ id: 'doc-1' });
    });

    it('404s for documents outside the org', async () => {
      const prisma = prismaMock([{ ...document, organizationId: 'other-org' }]);
      await expect(service({ prisma }).get('org-1', 'doc-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('ingest', () => {
    it('runs the full pipeline and emits document.ingested', async () => {
      const prisma = prismaMock([document]);
      const result = await service({ prisma }).ingest('org-1', 'doc-1');

      expect(storage.getObject).toHaveBeenCalledWith('org-1/uuid');
      expect(storage.putObject).toHaveBeenCalledWith(
        'org-1/doc-1/clean.txt',
        expect.any(Buffer),
        'text/plain; charset=utf-8',
      );
      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PROCESSING' } }),
      );
      expect(result.status).toBe('INDEXED');
      expect(result.cleanTextKey).toBe('org-1/doc-1/clean.txt');
      expect(prisma.knowledgeDocument.upsert).toHaveBeenCalledWith({
        where: { documentId: 'doc-1' },
        create: {
          organizationId: 'org-1',
          documentId: 'doc-1',
          title: 'invoice.pdf',
          objectKey: 'org-1/doc-1/clean.txt',
        },
        update: { title: 'invoice.pdf', objectKey: 'org-1/doc-1/clean.txt' },
      });
      expect(outbox.append).toHaveBeenCalledWith({
        aggregateType: 'document',
        aggregateId: 'doc-1',
        eventType: 'document.ingested',
        payload: expect.objectContaining({
          id: 'doc-1',
          objectKey: 'org-1/doc-1/clean.txt',
          paragraphs: 1,
        }),
      });
      expect(queue.enqueue).toHaveBeenCalledWith('ai-jobs', 'document.ingested', {
        documentId: 'doc-1',
        organizationId: 'org-1',
        objectKey: 'org-1/doc-1/clean.txt',
      });
      expect(queue.enqueue).toHaveBeenCalledWith('search-jobs', 'document.index', {
        documentId: 'doc-1',
        organizationId: 'org-1',
        objectKey: 'org-1/doc-1/clean.txt',
      });
    });

    it('rejects re-ingestion of an INDEXED document', async () => {
      const prisma = prismaMock([{ ...document, status: 'INDEXED' }]);
      await expect(service({ prisma }).ingest('org-1', 'doc-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
    });

    it('marks FAILED and emits document.ingestion_failed when storage is down', async () => {
      const prisma = prismaMock([document]);
      const noStorage: typeof storage = {
        getObject: jest.fn().mockRejectedValue(
          new ApiError({
            code: 'STORAGE_UNAVAILABLE',
            status: 503,
            message: 'Object storage is unavailable',
          }),
        ),
        putObject: jest.fn(),
      };
      await expect(
        service({ prisma, storage: noStorage }).ingest('org-1', 'doc-1'),
      ).rejects.toMatchObject({
        code: 'STORAGE_UNAVAILABLE',
      });
      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
      expect(outbox.append).toHaveBeenCalledWith({
        aggregateType: 'document',
        aggregateId: 'doc-1',
        eventType: 'document.ingestion_failed',
        payload: expect.objectContaining({ id: 'doc-1' }),
      });
    });

    it('marks FAILED when extraction rejects', async () => {
      const prisma = prismaMock([document]);
      const badExtractor: typeof extractor = {
        extract: jest
          .fn()
          .mockRejectedValue(
            new ApiError({ code: 'UNSUPPORTED_DOCUMENT', status: 422, message: 'no text layer' }),
          ),
      };
      await expect(
        service({ prisma, extractor: badExtractor }).ingest('org-1', 'doc-1'),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_DOCUMENT',
      });
      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('keeps ingestion successful when the job enqueues fail', async () => {
      const prisma = prismaMock([document]);
      const failingQueue: typeof queue = {
        enqueue: jest.fn().mockRejectedValue(new Error('redis down')),
      };
      const result = await service({ prisma, queue: failingQueue }).ingest('org-1', 'doc-1');
      expect(result.status).toBe('INDEXED');
      expect(outbox.append).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'document.ingested' }),
      );
    });

    it('fails closed when the database is not configured', async () => {
      await expect(service({ prisma: undefined }).ingest('org-1', 'doc-1')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 503,
      });
    });
  });
});
