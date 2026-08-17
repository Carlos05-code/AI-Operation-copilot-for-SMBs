/**
 * VectorStoreService: Qdrant wrapper for org-scoped document chunks
 * (DATABASE_SPEC §5).
 *
 * Collections follow the `doc_chunks_{org}` namespace pattern with Cosine
 * distance and payload indexes on `org_id` and `source_document_id`. Point
 * ids are deterministic (`sha1(documentId:index)`) so re-running a job
 * replaces vectors instead of duplicating them.
 *
 * Fail-soft: without `QDRANT_URL` every call throws
 * `VECTOR_STORE_UNAVAILABLE` (503).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { SEARCH_CANDIDATES } from '../search/search.constants';
import { SearchHit } from '../search/search.service';
import {
  CHUNK_TEXT_PAYLOAD_LIMIT,
  DEFAULT_EMBEDDING_DIMENSION,
  QDRANT_COLLECTION_PREFIX,
  QDRANT_DISTANCE,
} from './embeddings.constants';

export interface ChunkVector {
  text: string;
  vector: number[];
  index: number;
}

/** Payload shape stored on each Qdrant point (upserted by this service). */
interface QdrantPayload {
  source_document_id?: string;
  chunk_id?: string;
  text?: string;
  page?: number | null;
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(
    @Optional() private readonly client?: QdrantClient,
    private readonly dimension: number = DEFAULT_EMBEDDING_DIMENSION,
  ) {}

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  collectionName(organizationId: string): string {
    return `${QDRANT_COLLECTION_PREFIX}${organizationId}`;
  }

  /** Ensures the org collection exists (created once with payload indexes). */
  async ensureCollection(organizationId: string): Promise<string> {
    const client = this.requireClient();
    const name = this.collectionName(organizationId);
    try {
      const existing = await client.getCollections();
      if (!existing.collections.some((entry) => entry.name === name)) {
        await client.createCollection(name, {
          vectors: { size: this.dimension, distance: QDRANT_DISTANCE },
        });
        await client.createPayloadIndex(name, {
          field_name: 'org_id',
          field_schema: 'keyword',
        });
        await client.createPayloadIndex(name, {
          field_name: 'source_document_id',
          field_schema: 'keyword',
        });
        this.logger.log(`created collection ${name} (${this.dimension}d)`);
      }
      return name;
    } catch (error) {
      this.logger.error(`collection ${name} unavailable: ${(error as Error)?.message}`);
      throw this.unavailable('Vector store is unavailable');
    }
  }

  /** Upserts chunk vectors for a document into its org collection. */
  async upsertChunks(
    organizationId: string,
    documentId: string,
    chunks: ChunkVector[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const name = await this.ensureCollection(organizationId);
    const points = chunks.map((chunk) => ({
      id: chunkPointId(documentId, chunk.index),
      vector: chunk.vector,
      payload: {
        source_document_id: documentId,
        org_id: organizationId,
        chunk_id: `${documentId}:${chunk.index}`,
        page: null,
        text: chunk.text.slice(0, CHUNK_TEXT_PAYLOAD_LIMIT),
      },
    }));
    try {
      await this.requireClient().upsert(name, { wait: true, points });
    } catch (error) {
      this.logger.error(`upsert into ${name} failed: ${(error as Error)?.message}`);
      throw this.unavailable('Vector store is unavailable');
    }
  }

  /** Vector similarity search over the org collection (hybrid fusion input). */
  async searchSimilar(
    organizationId: string,
    vector: number[],
    limit: number = SEARCH_CANDIDATES,
  ): Promise<SearchHit[]> {
    const client = this.requireClient();
    const name = this.collectionName(organizationId);
    try {
      const existing = await client.getCollections();
      if (!existing.collections.some((entry) => entry.name === name)) {
        return [];
      }
      const response = await client.query(name, {
        query: vector,
        limit,
        with_payload: true,
      });
      return response.points.map((hit) => {
        const payload = (hit.payload ?? {}) as QdrantPayload;
        return {
          documentId: payload.source_document_id ?? '',
          chunkId: payload.chunk_id ?? '',
          text: payload.text ?? '',
          page: payload.page ?? null,
          score: hit.score,
        };
      });
    } catch (error) {
      this.logger.error(`search on ${name} failed: ${(error as Error)?.message}`);
      throw this.unavailable('Vector store is unavailable');
    }
  }

  private requireClient(): QdrantClient {
    if (!this.client) {
      throw new ApiError({
        code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
        status: 503,
        message: 'Vector store is not configured',
      });
    }
    return this.client;
  }

  private unavailable(message: string): ApiError {
    return new ApiError({
      code: HttpErrorCode.VECTOR_STORE_UNAVAILABLE,
      status: 503,
      message,
    });
  }
}

/** Deterministic point id for a document chunk (idempotent upserts). */
export function chunkPointId(documentId: string, index: number): string {
  return createHash('sha1').update(`${documentId}:${index}`).digest('hex');
}
