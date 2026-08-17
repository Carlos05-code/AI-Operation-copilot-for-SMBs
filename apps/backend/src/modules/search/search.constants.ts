/**
 * Search job/event names + indexing policy (AI_ARCHITECTURE §5, ADR-0012).
 *
 * Indexing reuses the deterministic `sha1(documentId:index)` ids from the
 * vector store so re-running a job replaces documents chunk-by-chunk instead
 * of duplicating them (idempotent upserts).
 */
export const JOB_INDEX_DOCUMENT = 'document.index';
export const EVENT_DOCUMENT_INDEXED = 'document.indexed';

/** Per-org OpenSearch index prefix; the full index is `search_{org}`. */
export const SEARCH_INDEX_PREFIX = 'search_';

/** Chunk text stored in the index (full chunk text, safety cap). */
export const SEARCH_TEXT_LIMIT = 4000;

/** Per-store candidate count fetched before hybrid fusion. */
export const SEARCH_CANDIDATES = 20;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

/** Reciprocal Rank Fusion constant (k=60 is the standard default). */
export const RRF_K = 60;
