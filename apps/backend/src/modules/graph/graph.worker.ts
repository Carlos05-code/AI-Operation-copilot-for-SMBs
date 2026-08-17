/**
 * GraphWorker: consumes `document.graph` jobs on the `graph-jobs` queue
 * (ADR-0005, DATABASE_SPEC §4).
 *
 * Pipeline: download the cleaned text object → chunk (shared chunker) →
 * extract entities per chunk (deterministic extractor, no LLM) → merge the
 * document/chunk/entity subgraph into Neo4j → emit `document.graph_indexed`
 * on the outbox. Re-runs converge (idempotent MERGEs).
 *
 * Fail-soft: without `NEO4J_URI` the job is skipped (never fails); transient
 * failures throw so BullMQ retries (3 attempts, exponential backoff). Outbox
 * write failures are logged, not fatal.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { chunkText } from '../embeddings/chunker';
import { OutboxService } from '../events/outbox.service';
import { QUEUE_GRAPH_JOBS } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { extractEntities } from './entity-extractor';
import { EVENT_DOCUMENT_GRAPH_INDEXED, JOB_GRAPH_DOCUMENT } from './graph.constants';
import { GraphService } from './graph.service';

export interface DocumentGraphJobData {
  documentId: string;
  organizationId: string;
  objectKey: string;
}

export interface GraphIndexingResult {
  documentId: string;
  graphChunks: number;
}

@Processor(QUEUE_GRAPH_JOBS)
export class GraphWorker extends WorkerHost {
  private readonly logger = new Logger(GraphWorker.name);

  constructor(
    private readonly storage: StorageService,
    private readonly graph: GraphService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job<DocumentGraphJobData>): Promise<unknown> {
    if (job.name !== JOB_GRAPH_DOCUMENT) {
      return { skipped: true };
    }
    const { documentId, organizationId, objectKey } = job.data;
    if (!this.graph.isConfigured) {
      this.logger.warn(`graph indexing skipped for ${documentId}: neo4j not configured`);
      return { skipped: 'not configured' };
    }

    const buffer = await this.storage.getObject(objectKey);
    const chunks = chunkText(buffer.toString('utf8')).map((chunk) => ({
      index: chunk.index,
      text: chunk.text,
      entities: extractEntities(chunk.text),
    }));
    await this.graph.upsertDocumentChunks(organizationId, documentId, chunks);

    try {
      await this.outbox?.append({
        aggregateType: 'document',
        aggregateId: documentId,
        eventType: EVENT_DOCUMENT_GRAPH_INDEXED,
        payload: { documentId, organizationId, chunkCount: chunks.length },
      });
    } catch (error) {
      this.logger.warn(`outbox append failed: ${(error as Error)?.message}`);
    }

    this.logger.log(`graph: indexed ${chunks.length} chunks for ${documentId}`);
    return { documentId, graphChunks: chunks.length } satisfies GraphIndexingResult;
  }
}
