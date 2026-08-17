/**
 * IngestionService: document ingestion pipeline (ROADMAP Phase 2).
 *
 * Flow (`POST /api/v1/documents/:id/ingest`):
 * PENDING/FAILED → PROCESSING → download bytes from MinIO → extract text
 * (pdf-parse / UTF-8) → clean (normalize, strip headers/footers) → store the
 * cleaned text as a `clean.txt` sidecar in MinIO → create/refresh the
 * knowledge_documents row → INDEXED, then emit `document.ingested` on the
 * outbox and enqueue an `ai-jobs` embedding job (fire-and-forget).
 *
 * Any failure marks the document FAILED and emits `document.ingestion_failed`.
 * At-least-once: the outbox row is written only after the row reaches INDEXED.
 *
 * Fail-soft: with no database or storage configured, explicit calls fail with
 * a contract error; the module never blocks application boot.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OutboxService } from '../events/outbox.service';
import { QueueService } from '../queue/queue.service';
import { cleanText } from './text-cleaner';
import { TextExtractionService } from './extraction.service';

export interface CreateDocumentInput {
  organizationId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly queue?: QueueService,
    private readonly extractor: TextExtractionService = new TextExtractionService(),
  ) {}

  /** Registers an uploaded object as a PENDING document. */
  async create(input: CreateDocumentInput): Promise<Document> {
    const prisma = this.requirePrisma();
    return prisma.document.create({
      data: {
        organizationId: input.organizationId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
      },
    });
  }

  /** Fetches an org-scoped document (404 when absent). */
  async get(organizationId: string, documentId: string): Promise<Document> {
    const prisma = this.requirePrisma();
    const document = await prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!document) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Document not found',
      });
    }
    return document;
  }

  /** Runs the ingestion pipeline for a document. */
  async ingest(organizationId: string, documentId: string): Promise<Document> {
    const prisma = this.requirePrisma();
    const document = await this.get(organizationId, documentId);
    if (document.status !== 'PENDING' && document.status !== 'FAILED') {
      throw new ApiError({
        code: HttpErrorCode.CONFLICT,
        status: 409,
        message: `Document is already ${document.status.toLowerCase()}`,
      });
    }

    await prisma.document.update({
      where: { id: document.id },
      data: { status: 'PROCESSING' },
    });

    try {
      const storage = this.storage;
      if (!storage) {
        throw new ApiError({
          code: HttpErrorCode.STORAGE_UNAVAILABLE,
          status: 503,
          message: 'Object storage is not configured',
        });
      }
      const raw = await storage.getObject(document.storageKey);
      const extracted = await this.extractor.extract(raw, document.contentType);
      const cleaned = cleanText(extracted.text);
      const cleanKey = `${organizationId}/${document.id}/clean.txt`;
      await storage.putObject(
        cleanKey,
        Buffer.from(cleaned.text, 'utf8'),
        'text/plain; charset=utf-8',
      );

      const updated = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.update({
          where: { id: document.id },
          data: { status: 'INDEXED', cleanTextKey: cleanKey },
        });
        await tx.knowledgeDocument.upsert({
          where: { documentId: document.id },
          create: {
            organizationId,
            documentId: document.id,
            title: document.fileName,
            objectKey: cleanKey,
          },
          update: { title: document.fileName, objectKey: cleanKey },
        });
        return doc;
      });

      await this.outbox?.append({
        aggregateType: 'document',
        aggregateId: document.id,
        eventType: 'document.ingested',
        payload: {
          id: document.id,
          organizationId,
          title: document.fileName,
          objectKey: cleanKey,
          paragraphs: cleaned.paragraphs,
          pageCount: extracted.pageCount,
        },
      });
      await this.enqueueEmbedding(organizationId, document.id, cleanKey);
      await this.enqueueSearch(organizationId, document.id, cleanKey);
      this.logger.log(`document ingested: ${document.id}`);
      return updated;
    } catch (error) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'FAILED' },
      });
      await this.outbox?.append({
        aggregateType: 'document',
        aggregateId: document.id,
        eventType: 'document.ingestion_failed',
        payload: { id: document.id, organizationId, error: (error as Error)?.message },
      });
      this.logger.warn(`document ingestion failed: ${document.id} — ${(error as Error)?.message}`);
      throw error;
    }
  }

  private async enqueueEmbedding(
    organizationId: string,
    documentId: string,
    objectKey: string,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue('ai-jobs', 'document.ingested', {
        documentId,
        organizationId,
        objectKey,
      });
    } catch (error) {
      // Redis down must not fail ingestion; the event bus still carries the
      // fact and embedding can be re-scheduled later.
      this.logger.warn(`embedding job enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private async enqueueSearch(
    organizationId: string,
    documentId: string,
    objectKey: string,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue('search-jobs', 'document.index', {
        documentId,
        organizationId,
        objectKey,
      });
    } catch (error) {
      // Same fail-soft contract as the embedding job: indexing can be
      // re-scheduled later from the event bus.
      this.logger.warn(`search job enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}
