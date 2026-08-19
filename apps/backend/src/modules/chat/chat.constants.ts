/**
 * Chat/RAG constants (AI_ARCHITECTURE §6–§10, API_SPEC §11.5).
 */
export const CHAT_DEFAULT_LIMIT = 5;
export const CHAT_MAX_LIMIT = 10;
export const CHAT_QUERY_MAX_LENGTH = 500;

/** Per-chunk text budget for the prompt context; the rest is elided. */
export const CHAT_CHUNK_LIMIT_CHARS = 800;
/** Total context budget for the prompt (AI_ARCHITECTURE §7, fast chat tier). */
export const CHAT_CONTEXT_BUDGET_CHARS = 12000;

/** Cap on the model's generated tokens. */
export const CHAT_MAX_TOKENS = 700;

/**
 * Retrieval-quality gate (AI_ARCHITECTURE §9.1): an answer counts as
 * `grounded` only when it cites a chunk whose fused RRF score reaches this
 * threshold (rank-1 in a single store ≈ 1/61 ≈ 0.016).
 */
export const CHAT_GROUND_MIN_SCORE = 0.01;

/** Versioned QA prompt (AI_ARCHITECTURE §6.1 `qa.document`). */
export const CHAT_PROMPT_VERSION = 'qa.document.v1';

export const DEFAULT_LLM_MODEL = 'gpt-4o';
