/**
 * Chat LLM configuration (AI_ARCHITECTURE §6–§7).
 *
 * `LLM_API_URL` points at any OpenAI-compatible `/chat/completions` endpoint
 * (OpenAI, Azure OpenAI, vLLM, local gateway). Without the URL the provider
 * is inert and chat fails with `LLM_UNAVAILABLE` (503) — chat cannot answer
 * without a model, unlike retrieval which degrades store by store.
 */
import { DEFAULT_LLM_MODEL } from './chat.constants';

export interface LlmConfig {
  apiUrl: string;
  apiKey?: string;
  model: string;
}

/** Resolves the LLM config; `null` when not configured. */
export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiUrl = env.LLM_API_URL;
  if (!apiUrl) return null;
  return {
    apiUrl,
    apiKey: env.LLM_API_KEY || undefined,
    model: env.LLM_MODEL ?? DEFAULT_LLM_MODEL,
  };
}
