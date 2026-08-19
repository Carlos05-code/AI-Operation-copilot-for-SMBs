/**
 * Unit tests — LLM config resolution (AI_ARCHITECTURE §6–§7).
 */
import { DEFAULT_LLM_MODEL } from './chat.constants';
import { llmConfig } from './llm.config';

describe('llmConfig', () => {
  it('returns null without LLM_API_URL', () => {
    expect(llmConfig({})).toBeNull();
    expect(llmConfig({ LLM_API_KEY: 'secret', LLM_MODEL: 'x' })).toBeNull();
  });

  it('resolves the URL, key, and default model', () => {
    expect(llmConfig({ LLM_API_URL: 'https://llm.example/v1' })).toEqual({
      apiUrl: 'https://llm.example/v1',
      apiKey: undefined,
      model: DEFAULT_LLM_MODEL,
    });
  });

  it('uses the configured model and key when present', () => {
    expect(
      llmConfig({ LLM_API_URL: 'https://llm.example/v1', LLM_API_KEY: 'k', LLM_MODEL: 'tiny' }),
    ).toEqual({ apiUrl: 'https://llm.example/v1', apiKey: 'k', model: 'tiny' });
  });
});
