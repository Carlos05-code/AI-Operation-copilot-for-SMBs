/**
 * Unit tests — OpenSearch configuration (fail-soft resolution).
 */
import { searchConfig } from './search.config';

describe('searchConfig', () => {
  it('returns null without OPENSEARCH_URL', () => {
    expect(searchConfig({})).toBeNull();
  });

  it('resolves url and optional credentials', () => {
    const env = {
      OPENSEARCH_URL: 'https://os.local:9200',
      OPENSEARCH_USERNAME: 'admin',
      OPENSEARCH_PASSWORD: 'secret',
    };
    expect(searchConfig(env)).toEqual({
      url: 'https://os.local:9200',
      username: 'admin',
      password: 'secret',
    });
  });

  it('omits empty credentials', () => {
    const env = { OPENSEARCH_URL: 'https://os.local:9200', OPENSEARCH_USERNAME: '' };
    const config = searchConfig(env);
    expect(config?.username).toBeUndefined();
    expect(config?.password).toBeUndefined();
  });
});
