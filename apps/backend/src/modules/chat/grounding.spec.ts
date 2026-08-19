/**
 * Unit tests — deterministic grounding of chat answers (AI_ARCHITECTURE §8–§10).
 */
import { groundAnswer, parseLlmAnswer, type RawLlmAnswer } from './grounding';

const context = [
  { documentId: 'doc-1', chunkId: 'doc-1:0', page: 3, score: 0.04 },
  { documentId: 'doc-1', chunkId: 'doc-1:1', page: null, score: 0.02 },
  { documentId: 'doc-2', chunkId: 'doc-2:0', page: null, score: 0.01 },
];

describe('parseLlmAnswer', () => {
  it('parses plain JSON', () => {
    const raw = parseLlmAnswer('{"answer":"a","citations":[{"document_id":"d","chunk_id":"c"}]}');
    expect(raw.answer).toBe('a');
    expect(raw.citations).toHaveLength(1);
  });

  it('tolerates markdown code fences', () => {
    const raw = parseLlmAnswer('```json\n{"answer":"a","citations":[]}\n```');
    expect(raw.answer).toBe('a');
  });

  it('rejects non-object output', () => {
    expect(() => parseLlmAnswer('42')).toThrow();
    expect(() => parseLlmAnswer('"hello"')).toThrow();
  });

  it('rejects output missing the answer or citations', () => {
    expect(() => parseLlmAnswer('{"answer":""}')).toThrow();
    expect(() => parseLlmAnswer('{"citations":[]}')).toThrow();
    expect(() => parseLlmAnswer('{"answer":"a","citations":"none"}')).toThrow();
  });
});

describe('groundAnswer', () => {
  it('drops citations that are not in the retrieved context', () => {
    const grounded = groundAnswer(
      {
        answer: 'a',
        citations: [
          { document_id: 'doc-1', chunk_id: 'doc-1:0' },
          { document_id: 'doc-x', chunk_id: 'nope' },
          { document_id: 'doc-1', chunk_id: 'doc-1:0' },
        ],
      },
      context,
    );
    expect(grounded.citations).toHaveLength(1);
    expect(grounded.citations[0]?.chunkId).toBe('doc-1:0');
  });

  it('is grounded with a high-scoring citation, synthesis direct', () => {
    const grounded = groundAnswer(
      { answer: 'a', citations: [{ document_id: 'doc-1', chunk_id: 'doc-1:0' }] },
      context,
    );
    expect(grounded.grounded).toBe(true);
    expect(grounded.synthesis).toBe('direct');
    expect(grounded.confidence).toBeCloseTo(0.97);
  });

  it('is derived when the best cited chunk is not the retrieval top-1', () => {
    const grounded = groundAnswer(
      { answer: 'a', citations: [{ document_id: 'doc-1', chunk_id: 'doc-1:1' }] },
      context,
    );
    expect(grounded.grounded).toBe(true);
    expect(grounded.synthesis).toBe('derived');
  });

  it('is fallback with no citations and confidence 0', () => {
    const grounded = groundAnswer({ answer: 'a', citations: [] }, context);
    expect(grounded.grounded).toBe(false);
    expect(grounded.synthesis).toBe('fallback');
    expect(grounded.confidence).toBeCloseTo(0.3);
  });

  it('is fallback when the cited chunk is below the grounding threshold', () => {
    const grounded = groundAnswer(
      { answer: 'a', citations: [{ document_id: 'doc-2', chunk_id: 'doc-2:0' }] },
      [{ documentId: 'doc-2', chunkId: 'doc-2:0', page: null, score: 0.005 }],
    );
    expect(grounded.grounded).toBe(false);
    expect(grounded.synthesis).toBe('fallback');
  });

  it('caps the confidence at 0.97', () => {
    const rich: RawLlmAnswer = {
      answer: 'a',
      citations: context.map((c) => ({ document_id: c.documentId, chunk_id: c.chunkId })),
    };
    const grounded = groundAnswer(rich, context);
    expect(grounded.confidence).toBeLessThanOrEqual(0.97);
  });
});
