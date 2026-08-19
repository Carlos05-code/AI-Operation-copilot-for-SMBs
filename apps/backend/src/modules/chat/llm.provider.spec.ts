/**
 * Unit tests — LlmProvider (OpenAI-compatible chat completions client).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { LlmProvider } from './llm.provider';

function fetchMock(response?: () => Partial<Response>): jest.Mock {
  const mock = jest.fn();
  mock.mockImplementation(() =>
    Promise.resolve(
      (response
        ? response()
        : {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ choices: [{ message: { content: '{"answer":"hi"}' } }] }),
          }) as Response,
    ),
  );
  return mock;
}

describe('LlmProvider', () => {
  it('throws LLM_UNAVAILABLE when not configured', async () => {
    const provider = new LlmProvider(undefined);
    expect(provider.isConfigured).toBe(false);
    await expect(provider.complete('s', 'u')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });

  it('posts the chat completion request with auth and returns the content', async () => {
    const fetch = fetchMock();
    globalThis.fetch = fetch;
    const provider = new LlmProvider({
      apiUrl: 'https://llm.example/v1/',
      apiKey: 'secret',
      model: 'tiny',
    });
    const output = await provider.complete('system prompt', 'user prompt');
    expect(output).toBe('{"answer":"hi"}');
    expect(fetch).toHaveBeenCalledWith('https://llm.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({
        model: 'tiny',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    });
  });

  it('omits the auth header without an API key', async () => {
    const fetch = fetchMock();
    globalThis.fetch = fetch;
    const provider = new LlmProvider({ apiUrl: 'https://llm.example/v1', model: 'tiny' });
    await provider.complete('s', 'u');
    const options = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('maps HTTP errors to LLM_UNAVAILABLE', async () => {
    const fetch = fetchMock(() => ({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    }));
    globalThis.fetch = fetch;
    const provider = new LlmProvider({ apiUrl: 'https://llm.example/v1', model: 'tiny' });
    await expect(provider.complete('s', 'u')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });

  it('maps malformed responses to LLM_UNAVAILABLE', async () => {
    globalThis.fetch = fetchMock(() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [] }),
    }));
    const provider = new LlmProvider({ apiUrl: 'https://llm.example/v1', model: 'tiny' });
    await expect(provider.complete('s', 'u')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });

  it('maps network failures to LLM_UNAVAILABLE', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const provider = new LlmProvider({ apiUrl: 'https://llm.example/v1', model: 'tiny' });
    await expect(provider.complete('s', 'u')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });
});
