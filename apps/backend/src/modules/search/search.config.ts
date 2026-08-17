/**
 * OpenSearch configuration (ADR-0012, DATABASE_SPEC §6).
 *
 * Without `OPENSEARCH_URL` the search service is inert (fail-soft): the
 * indexing worker skips jobs and hybrid retrieval degrades to vector-only
 * instead of failing the request.
 */
export interface SearchConfig {
  url: string;
  username?: string;
  password?: string;
}

/** Resolves the OpenSearch config; `null` when not configured. */
export function searchConfig(env: NodeJS.ProcessEnv = process.env): SearchConfig | null {
  const url = env.OPENSEARCH_URL;
  if (!url) return null;
  return {
    url,
    username: env.OPENSEARCH_USERNAME || undefined,
    password: env.OPENSEARCH_PASSWORD || undefined,
  };
}
