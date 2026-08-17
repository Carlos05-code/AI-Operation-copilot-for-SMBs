/**
 * Graph pipeline constants (ADR-0005, DATABASE_SPEC §4).
 *
 * Chunk ids reuse the deterministic `sha1(documentId:index)` scheme from the
 * vector store / search index, so re-running a job merges the same nodes and
 * edges instead of duplicating them.
 */
export const JOB_GRAPH_DOCUMENT = 'document.graph';
export const EVENT_DOCUMENT_GRAPH_INDEXED = 'document.graph_indexed';

/** Chunk text kept on `:Chunk` nodes (retrieval context preview). */
export const GRAPH_CHUNK_TEXT_LIMIT = 600;

/** Max entities extracted from a single chunk. */
export const MAX_ENTITIES_PER_CHUNK = 25;

/** Max characters of a canonical entity name. */
export const MAX_ENTITY_LENGTH = 64;
