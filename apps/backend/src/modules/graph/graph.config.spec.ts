/**
 * Unit tests — Neo4j configuration (fail-soft resolution).
 */
import { graphConfig } from './graph.config';

describe('graphConfig', () => {
  it('returns null without NEO4J_URI', () => {
    expect(graphConfig({})).toBeNull();
  });

  it('resolves uri, credentials, and optional database', () => {
    const env = {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'secret',
      NEO4J_DATABASE: 'smb_copilot',
    };
    expect(graphConfig(env)).toEqual({
      uri: 'bolt://localhost:7687',
      user: 'neo4j',
      password: 'secret',
      database: 'smb_copilot',
    });
  });

  it('applies defaults for missing credentials', () => {
    const config = graphConfig({ NEO4J_URI: 'bolt://localhost:7687' });
    expect(config?.user).toBe('neo4j');
    expect(config?.password).toBe('');
    expect(config?.database).toBeUndefined();
  });
});
