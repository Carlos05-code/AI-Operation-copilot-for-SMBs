/**
 * Embeddings pipeline constants (AI_ARCHITECTURE §4-5, DATABASE_SPEC §5).
 */
export const JOB_DOCUMENT_INGESTED = 'document.ingested';
export const EVENT_DOCUMENT_EMBEDDED = 'document.embedded';

export const DEFAULT_EMBEDDING_DIMENSION = 1024;
export const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-m3';
export const EMBEDDING_BATCH_SIZE = 64;

export const CHUNK_TARGET_TOKENS = 384;
export const CHUNK_OVERLAP_TOKENS = 64;
export const TOKENS_PER_CHAR = 1 / 4;

export const QDRANT_COLLECTION_PREFIX = 'doc_chunks_';
export const QDRANT_DISTANCE = 'Cosine';

/** Chunk text stored in the vector payload (full chunk text, safety cap). */
export const CHUNK_TEXT_PAYLOAD_LIMIT = 4000;
