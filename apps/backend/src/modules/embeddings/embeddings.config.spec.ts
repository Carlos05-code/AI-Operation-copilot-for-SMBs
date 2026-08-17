/**
 * Unit tests — embeddings/Qdrant environment config.
 */
import { DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL } from './embeddings.constants';
import { embeddingProviderConfig, qdrantConfig } from './embeddings.config';

describe('embeddingProviderConfig', () => {
  it('returns null without EMBEDDINGS_API_URL', () => {
    expect(embeddingProviderConfig({})).toBeNull();
  });

  it('applies defaults for model and dimension', () => {
    const config = embeddingProviderConfig({ EMBEDDINGS_API_URL: 'https://ai.local/v1' });
    expect(config).toEqual({
      apiUrl: 'https://ai.local/v1',
      model: DEFAULT_EMBEDDING_MODEL,
      dimension: DEFAULT_EMBEDDING_DIMENSION,
    });
  });

  it('reads custom model, key, and dimension', () => {
    const config = embeddingProviderConfig({
      EMBEDDINGS_API_URL: 'https://ai.local/v1',
      EMBEDDINGS_API_KEY: 'secret',
      EMBEDDINGS_MODEL: 'text-embedding-3-small',
      EMBEDDINGS_DIMENSION: '768',
    });
    expect(config?.apiKey).toBe('secret');
    expect(config?.model).toBe('text-embedding-3-small');
    expect(config?.dimension).toBe(768);
  });
});

describe('qdrantConfig', () => {
  it('returns null without QDRANT_URL', () => {
    expect(qdrantConfig({})).toBeNull();
  });

  it('reads url and optional api key', () => {
    expect(qdrantConfig({ QDRANT_URL: 'http://localhost:6333' })).toEqual({
      url: 'http://localhost:6333',
    });
    expect(qdrantConfig({ QDRANT_URL: 'http://localhost:6333', QDRANT_API_KEY: 'k' })).toEqual({
      url: 'http://localhost:6333',
      apiKey: 'k',
    });
  });
});
