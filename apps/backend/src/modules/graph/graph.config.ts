/**
 * Neo4j configuration (ADR-0005, DATABASE_SPEC §4).
 *
 * Without `NEO4J_URI` the graph service is inert (fail-soft): the indexing
 * worker skips jobs and hybrid retrieval degrades to the other stores.
 */
export interface GraphConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

/** Resolves the Neo4j config; `null` when not configured. */
export function graphConfig(env: NodeJS.ProcessEnv = process.env): GraphConfig | null {
  const uri = env.NEO4J_URI;
  if (!uri) return null;
  return {
    uri,
    user: env.NEO4J_USER ?? 'neo4j',
    password: env.NEO4J_PASSWORD ?? '',
    database: env.NEO4J_DATABASE || undefined,
  };
}
