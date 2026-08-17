/**
 * Embeddings + Qdrant configuration (AI_ARCHITECTURE §5, DATABASE_SPEC §5).
 *
 * `EMBEDDINGS_API_URL` points at any OpenAI-compatible `/embeddings` endpoint
 * (BGE-M3 behind vLLM/OpenSearch, OpenAI, local gateway). Without the URL the
 * provider is inert; without `QDRANT_URL` the vector store is inert — both
 * fail-soft so local runs without infra still boot.
 */
import { DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL } from './embeddings.constants';

export interface EmbeddingProviderConfig {
  apiUrl: string;
  apiKey?: string;
  model: string;
  dimension: number;
}

export interface QdrantConfig {
  url: string;
  apiKey?: string;
}

/** Resolves the embeddings provider config; `null` when not configured. */
export function embeddingProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProviderConfig | null {
  const apiUrl = env.EMBEDDINGS_API_URL;
  if (!apiUrl) return null;
  return {
    apiUrl,
    apiKey: env.EMBEDDINGS_API_KEY || undefined,
    model: env.EMBEDDINGS_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    dimension: Number(env.EMBEDDINGS_DIMENSION ?? DEFAULT_EMBEDDING_DIMENSION),
  };
}

/** Resolves the Qdrant config; `null` when not configured. */
export function qdrantConfig(env: NodeJS.ProcessEnv = process.env): QdrantConfig | null {
  const url = env.QDRANT_URL;
  if (!url) return null;
  return { url, apiKey: env.QDRANT_API_KEY || undefined };
}
