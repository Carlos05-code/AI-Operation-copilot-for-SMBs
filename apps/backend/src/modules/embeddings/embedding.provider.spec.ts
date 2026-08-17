/**
 * Unit tests — EmbeddingProvider (OpenAI-compatible client).
 */
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { EmbeddingProvider } from './embedding.provider';
import type { EmbeddingProviderConfig } from './embeddings.config';

const config: EmbeddingProviderConfig = {
  apiUrl: 'https://ai.local/v1',
  apiKey: 'secret',
  model: 'BAAI/bge-m3',
  dimension: 1024,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue(response);
  globalThis.fetch = fn;
  return fn;
}

describe('EmbeddingProvider', () => {
  it('reports isConfigured and dimension', () => {
    const provider = new EmbeddingProvider(config);
    expect(provider.isConfigured).toBe(true);
    expect(provider.dimension).toBe(1024);
    expect(new EmbeddingProvider(undefined).isConfigured).toBe(false);
  });

  it('throws EMBEDDINGS_UNAVAILABLE when not configured', async () => {
    const provider = new EmbeddingProvider(undefined);
    await expect(provider.embed(['a'])).rejects.toMatchObject({
      code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE,
      status: 503,
    });
  });

  it('returns immediately for an empty batch', async () => {
    const fetchMock = mockFetch({ ok: true, json: () => ({ data: [] }) });
    const provider = new EmbeddingProvider(config);
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to {apiUrl}/embeddings with model, input, and auth', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    });
    const provider = new EmbeddingProvider(config);
    const vectors = await provider.embed(['first', 'second']);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.local/v1/embeddings');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(options.body as string)).toEqual({
      model: 'BAAI/bge-m3',
      input: ['first', 'second'],
    });
  });

  it('strips a trailing slash from the api url', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => ({ data: [{ embedding: [0.1] }] }),
    });
    const provider = new EmbeddingProvider({ ...config, apiUrl: 'https://ai.local/v1/' });
    await provider.embed(['a']);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://ai.local/v1/embeddings',
    );
  });

  it('maps HTTP errors to EMBEDDINGS_UNAVAILABLE', async () => {
    mockFetch({ ok: false, status: 500, text: () => 'boom' });
    const provider = new EmbeddingProvider(config);
    await expect(provider.embed(['a'])).rejects.toMatchObject({
      code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE,
      status: 503,
    });
  });

  it('maps malformed responses to EMBEDDINGS_UNAVAILABLE', async () => {
    mockFetch({ ok: true, json: () => ({ data: [{ embedding: [1] }] }) });
    const provider = new EmbeddingProvider(config);
    await expect(provider.embed(['a', 'b'])).rejects.toBeInstanceOf(ApiError);
  });
});
