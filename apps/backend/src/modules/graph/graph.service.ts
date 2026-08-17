/**
 * GraphService: Neo4j wrapper for the knowledge graph (ADR-0005,
 * DATABASE_SPEC §4).
 *
 * Model per DATABASE_SPEC §4: `(:Document {id, org_id})`,
 * `(:Chunk {id, document_id, org_id, index, text})`,
 * `(:Entity {canonical, org_id, kind})`, with `HAS_CHUNK` (document → chunk)
 * and `CONTAINS` (chunk → entity) edges. All writes are idempotent `MERGE`s
 * keyed on deterministic ids, so re-running a job converges instead of
 * duplicating. It is a derived read-model — PostgreSQL stays the source of
 * truth, and failures never block ingestion.
 *
 * Fail-soft: without `NEO4J_URI` every call throws `GRAPH_UNAVAILABLE` (503).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Driver, Session } from 'neo4j-driver';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { chunkPointId } from '../embeddings/vector-store.service';
import type { SearchHit } from '../search/search.service';
import { ExtractedEntity } from './entity-extractor';
import { GRAPH_CHUNK_TEXT_LIMIT } from './graph.constants';

export interface GraphChunk {
  index: number;
  text: string;
  entities: ExtractedEntity[];
}

/** Idempotent upsert: merge nodes + edges for a document's chunks. */
const UPSERT_CYPHER = `
UNWIND $rows AS row
MERGE (d:Document {id: row.document_id})
SET d.org_id = row.organization_id
MERGE (c:Chunk {id: row.chunk_id})
SET c.document_id = row.document_id, c.org_id = row.organization_id,
    c.index = row.index, c.text = row.text
MERGE (d)-[:HAS_CHUNK]->(c)
WITH c, row
UNWIND row.entities AS entity
MERGE (e:Entity {canonical: entity.canonical, org_id: row.organization_id})
SET e.kind = entity.kind
MERGE (c)-[:CONTAINS]->(e)
`;

/** Chunks mentioning any of the query entities, scored by matches. */
const SEARCH_CYPHER = `
MATCH (c:Chunk {org_id: $organizationId})-[:CONTAINS]->(e:Entity)
WHERE e.org_id = $organizationId AND e.canonical IN $entities
WITH c, count(DISTINCT e) AS matched
RETURN c.id AS chunk_id, c.document_id AS document_id, c.text AS text,
       matched AS score
ORDER BY matched DESC, c.id
LIMIT $limit
`;

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    @Optional() private readonly driver?: Driver,
    @Optional() private readonly database?: string,
  ) {}

  get isConfigured(): boolean {
    return this.driver !== undefined;
  }

  /** Merges a document's chunks and their entities into the graph. */
  async upsertDocumentChunks(
    organizationId: string,
    documentId: string,
    chunks: GraphChunk[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const rows = chunks.map((chunk) => ({
      document_id: documentId,
      organization_id: organizationId,
      chunk_id: chunkPointId(documentId, chunk.index),
      index: chunk.index,
      text: chunk.text.slice(0, GRAPH_CHUNK_TEXT_LIMIT),
      entities: chunk.entities.map((entity) => ({
        canonical: entity.canonical,
        kind: entity.kind,
      })),
    }));
    const session = this.openSession();
    try {
      await session.executeWrite((tx) => tx.run(UPSERT_CYPHER, { rows }));
      this.logger.log(`graph: upserted ${chunks.length} chunks for ${documentId}`);
    } catch (error) {
      this.logger.error(`graph upsert for ${documentId} failed: ${(error as Error)?.message}`);
      throw this.unavailable('Knowledge graph is unavailable');
    } finally {
      await session.close();
    }
  }

  /** Chunks that mention any of the given entity canonicals (graph expansion). */
  async searchByEntities(
    organizationId: string,
    entities: string[],
    limit: number,
  ): Promise<SearchHit[]> {
    if (entities.length === 0) return [];
    const session = this.openSession();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(SEARCH_CYPHER, { organizationId, entities, limit }),
      );
      return result.records.map((record) => ({
        documentId: String(record.get('document_id')),
        chunkId: String(record.get('chunk_id')),
        text: String(record.get('text')),
        page: null,
        score: Number(record.get('score')),
      }));
    } catch (error) {
      this.logger.error(`graph search failed: ${(error as Error)?.message}`);
      throw this.unavailable('Knowledge graph is unavailable');
    } finally {
      await session.close();
    }
  }

  private openSession(): Session {
    const session = this.requireDriver().session(
      this.database ? { database: this.database } : undefined,
    );
    return session;
  }

  private requireDriver(): Driver {
    if (!this.driver) {
      throw new ApiError({
        code: HttpErrorCode.GRAPH_UNAVAILABLE,
        status: 503,
        message: 'Knowledge graph is not configured',
      });
    }
    return this.driver;
  }

  private unavailable(message: string): ApiError {
    return new ApiError({
      code: HttpErrorCode.GRAPH_UNAVAILABLE,
      status: 503,
      message,
    });
  }
}
