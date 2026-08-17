/**
 * SearchWorker: consumes `document.index` jobs on the `search-jobs` queue
 * (AI_ARCHITECTURE §5, ADR-0012).
 *
 * Pipeline: download the cleaned text object → chunk (same heuristics as the
 * embedding pipeline) → index chunks into the org's `search_{org}` index →
 * emit `document.indexed` on the outbox. Re-indexing a document replaces its
 * chunks (deterministic ids), so re-runs are idempotent.
 *
 * Fail-soft: without `OPENSEARCH_URL` the job is skipped (never fails);
 * transient failures throw so BullMQ retries (3 attempts, exponential
 * backoff). Outbox write failures are logged, not fatal.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { chunkText } from '../embeddings/chunker';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_SEARCH_JOBS } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { EVENT_DOCUMENT_INDEXED, JOB_INDEX_DOCUMENT } from './search.constants';
import { SearchService } from './search.service';

export interface DocumentIndexJobData {
  documentId: string;
  organizationId: string;
  objectKey: string;
}

export interface IndexingResult {
  documentId: string;
  indexedChunks: number;
}

@Processor(QUEUE_SEARCH_JOBS)
export class SearchWorker extends WorkerHost {
  private readonly logger = new Logger(SearchWorker.name);

  constructor(
    private readonly storage: StorageService,
    private readonly search: SearchService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<DocumentIndexJobData>): Promise<unknown> {
    if (job.name !== JOB_INDEX_DOCUMENT) {
      return { skipped: true };
    }
    const { documentId, organizationId, objectKey } = job.data;
    if (!this.search.isConfigured) {
      this.logger.warn(`indexing skipped for ${documentId}: opensearch not configured`);
      return { skipped: 'not configured' };
    }

    const buffer = await this.storage.getObject(objectKey);
    const chunks = chunkText(buffer.toString('utf8'));
    await this.search.indexChunks(organizationId, documentId, chunks);

    try {
      await this.outbox?.append({
        aggregateType: 'document',
        aggregateId: documentId,
        eventType: EVENT_DOCUMENT_INDEXED,
        payload: { documentId, organizationId, chunkCount: chunks.length },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`indexed ${chunks.length} chunks for ${documentId}`);
    return { documentId, indexedChunks: chunks.length } satisfies IndexingResult;
  }
}
