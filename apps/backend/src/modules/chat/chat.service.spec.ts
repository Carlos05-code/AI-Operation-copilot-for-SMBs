/**
 * Unit tests — ChatService (retrieval → prompt → LLM → grounding).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { HybridSearchService } from '../search/hybrid-search.service';
import type { SearchHit } from '../search/search.service';
import { ChatService } from './chat.service';
import type { LlmProvider } from './llm.provider';
import { QA_SYSTEM_PROMPT } from './qa.prompt';

function harness(
  overrides: {
    hybrid?: { isConfigured?: boolean; search: jest.Mock };
    llm?: { isConfigured?: boolean; complete: jest.Mock };
  } = {},
): {
  chat: ChatService;
  hybrid: { search: jest.Mock };
  llm: { complete: jest.Mock };
} {
  const hybrid = overrides.hybrid ?? { search: jest.fn() };
  const llm = overrides.llm ?? { complete: jest.fn() };
  const chat = new ChatService(
    hybrid as unknown as HybridSearchService,
    llm as unknown as LlmProvider,
  );
  return { chat, hybrid, llm };
}

const hit = (
  documentId: string,
  chunkId: string,
  score: number,
  text = 'chunk text',
): SearchHit => ({
  documentId,
  chunkId,
  text,
  page: null,
  score,
});

const llmJson = (answer: string, citations: Array<Record<string, unknown>>) =>
  JSON.stringify({ answer, citations });

describe('ChatService', () => {
  it('returns a disclaimer without calling the LLM when retrieval finds nothing', async () => {
    const { chat, hybrid, llm } = harness();
    hybrid.search.mockResolvedValue([]);
    const result = await chat.answer('org-1', 'anything');
    expect(result.grounded).toBe(false);
    expect(result.synthesis).toBe('fallback');
    expect(result.citations).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('grounds an LLM answer against the retrieved context', async () => {
    const { chat, hybrid, llm } = harness();
    hybrid.search.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.04), hit('doc-2', 'doc-2:0', 0.02)]);
    llm.complete.mockResolvedValue(
      llmJson('The answer [source:doc-1:doc-1:0].', [
        { document_id: 'doc-1', chunk_id: 'doc-1:0', page: null },
      ]),
    );
    const result = await chat.answer('org-1', 'the question');
    expect(llm.complete).toHaveBeenCalledWith(
      QA_SYSTEM_PROMPT,
      expect.stringContaining('## Question\nthe question'),
    );
    expect(result.answer).toBe('The answer [source:doc-1:doc-1:0].');
    expect(result.citations).toEqual([
      { documentId: 'doc-1', chunkId: 'doc-1:0', page: null, score: 0.04 },
    ]);
    expect(result.grounded).toBe(true);
  });

  it('drops citations the model invented', async () => {
    const { chat, hybrid, llm } = harness();
    hybrid.search.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.04)]);
    llm.complete.mockResolvedValue(
      llmJson('a', [
        { document_id: 'doc-1', chunk_id: 'doc-1:0' },
        { document_id: 'doc-9', chunk_id: 'hallucinated' },
      ]),
    );
    const result = await chat.answer('org-1', 'q');
    expect(result.citations).toHaveLength(1);
  });

  it('trims long chunks to the prompt budget', async () => {
    const { chat, hybrid, llm } = harness();
    const long = 'x'.repeat(5000);
    hybrid.search.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.04, long)]);
    llm.complete.mockResolvedValue(llmJson('a', []));
    await chat.answer('org-1', 'q');
    const userPrompt = llm.complete.mock.calls[0]?.[1] as string;
    expect(userPrompt).toContain(`${'x'.repeat(800)}…`);
  });

  it('propagates LLM failures as LLM_UNAVAILABLE', async () => {
    const { chat, hybrid, llm } = harness();
    hybrid.search.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.04)]);
    llm.complete.mockRejectedValue(
      Object.assign(new Error('down'), { code: HttpErrorCode.LLM_UNAVAILABLE, status: 503 }),
    );
    await expect(chat.answer('org-1', 'q')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });

  it('maps unparseable LLM output to LLM_UNAVAILABLE', async () => {
    const { chat, hybrid, llm } = harness();
    hybrid.search.mockResolvedValue([hit('doc-1', 'doc-1:0', 0.04)]);
    llm.complete.mockResolvedValue('sorry, no JSON here');
    await expect(chat.answer('org-1', 'q')).rejects.toMatchObject({
      code: HttpErrorCode.LLM_UNAVAILABLE,
      status: 503,
    });
  });

  it('propagates retrieval failures unchanged', async () => {
    const { chat, hybrid } = harness();
    hybrid.search.mockRejectedValue(
      Object.assign(new Error('not configured'), {
        code: HttpErrorCode.SEARCH_UNAVAILABLE,
        status: 503,
      }),
    );
    await expect(chat.answer('org-1', 'q')).rejects.toMatchObject({
      code: HttpErrorCode.SEARCH_UNAVAILABLE,
    });
  });
});
