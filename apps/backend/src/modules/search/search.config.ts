/**
 * OpenSearch configuration (ADR-0012, DATABASE_SPEC §6).
 *
 * Without `OPENSEARCH_URL` the search service is inert (fail-soft): the
 * indexing worker skips jobs and hybrid retrieval degrades to vector-only
 * instead of failing the request.
 */
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { SearchService } from './search.service';

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

/**
 * Builds `SearchService` from env — shared by `search.module.ts` (HTTP) and
 * `search-worker.module.ts` (worker) so the two independent module graphs
 * can't drift on how the OpenSearch client gets constructed.
 */
export function createSearchService(): SearchService {
  const config = searchConfig();
  if (!config) return new SearchService(undefined);
  return new SearchService(
    new OpenSearchClient({
      node: config.url,
      auth: config.username
        ? { username: config.username, password: config.password ?? '' }
        : undefined,
    }),
  );
}
