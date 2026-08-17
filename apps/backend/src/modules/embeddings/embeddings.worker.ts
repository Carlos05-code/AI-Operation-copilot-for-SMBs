/**
 * EmbeddingsWorker: consumes `document.ingested` jobs on the `ai-jobs` queue
 * (AI_ARCHITECTURE §4-5).
 *
 * Pipeline: download the cleaned text object → chunk → embed in batches →
 * upsert vectors into the org's Qdrant collection → emit `document.embedded`
 * on the outbox.
 *
 * Fail-soft: when embeddings/Qdrant are not configured the job is skipped
 * (never fails); transient failures throw so BullMQ retries (3 attempts,
 * exponential backoff). Outbox write failures are logged, not fatal.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { OutboxService } from '../events/outbox.service';
import { StorageService } from '../storage/storage.service';
import { chunkText } from './chunker';
import { EmbeddingProvider } from './embedding.provider';
import {
  EMBEDDING_BATCH_SIZE,
  EVENT_DOCUMENT_EMBEDDED,
  JOB_DOCUMENT_INGESTED,
} from './embeddings.constants';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import { VectorStoreService } from './vector-store.service';

export interface DocumentIngestedJobData {
  documentId: string;
  organizationId: string;
  objectKey: string;
}

export interface EmbeddingResult {
  documentId: string;
  embeddedChunks: number;
}

@Processor(QUEUE_AI_JOBS)
export class EmbeddingsWorker extends WorkerHost {
  private readonly logger = new Logger(EmbeddingsWorker.name);

  constructor(
    private readonly storage: StorageService,
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStoreService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<DocumentIngestedJobData>): Promise<unknown> {
    if (job.name !== JOB_DOCUMENT_INGESTED) {
      return { skipped: true };
    }
    const { documentId, organizationId, objectKey } = job.data;
    if (!this.provider.isConfigured || !this.vectorStore.isConfigured) {
      this.logger.warn(`embedding skipped for ${documentId}: embeddings/qdrant not configured`);
      return { skipped: 'not configured' };
    }

    const buffer = await this.storage.getObject(objectKey);
    const chunks = chunkText(buffer.toString('utf8'));
    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      vectors.push(...(await this.provider.embed(batch.map((chunk) => chunk.text))));
    }

    await this.vectorStore.upsertChunks(
      organizationId,
      documentId,
      chunks.map((chunk, i) => ({
        text: chunk.text,
        vector: vectors[i],
        index: chunk.index,
      })),
    );

    try {
      await this.outbox?.append({
        aggregateType: 'document',
        aggregateId: documentId,
        eventType: EVENT_DOCUMENT_EMBEDDED,
        payload: { documentId, organizationId, chunkCount: chunks.length },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`embedded ${chunks.length} chunks for ${documentId}`);
    return { documentId, embeddedChunks: chunks.length } satisfies EmbeddingResult;
  }
}
