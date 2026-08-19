/**
 * Deterministic grounding for chat answers (AI_ARCHITECTURE §8–§10).
 *
 * Grounding is "deterministic first": no entailment LLM yet. The model's
 * citations are validated against the actual retrieved context (constrained
 * generation, §9.2), and `grounded`/`confidence`/`synthesis` derive from the
 * fused retrieval scores of the cited chunks (§9.1 quality gating, §10).
 *
 * - `grounded`  — at least one valid citation with a fused score ≥ threshold.
 * - `synthesis` — `direct` when the best cited chunk is the retrieval top-1,
 *   `derived` when grounded on lower-ranked chunks, `fallback` otherwise.
 * - `confidence` — calibrated-ish heuristic: 0.30 base + 18×top cited fused
 *   score + 0.10 per cited chunk (capped at 3), clamped to [0.10, 0.97].
 */
import { CHAT_GROUND_MIN_SCORE } from './chat.constants';

export interface ChatCitation {
  documentId: string;
  chunkId: string;
  page: number | null;
  score: number;
}

export interface GroundedAnswer {
  answer: string;
  citations: ChatCitation[];
  confidence: number;
  grounded: boolean;
  synthesis: 'direct' | 'derived' | 'fallback';
}

export interface RawLlmAnswer {
  answer: string;
  citations: Array<{ document_id?: unknown; chunk_id?: unknown; page?: unknown }>;
}

/** Parses the model's JSON answer, tolerating markdown code fences. */
export function parseLlmAnswer(text: string): RawLlmAnswer {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM answer is not a JSON object');
  }
  const answer = (parsed as RawLlmAnswer).answer;
  const citations = (parsed as RawLlmAnswer).citations;
  if (typeof answer !== 'string' || answer.length === 0 || !Array.isArray(citations)) {
    throw new Error('LLM answer is missing answer or citations');
  }
  return { answer, citations };
}

interface ContextSource {
  documentId: string;
  chunkId: string;
  page: number | null;
  score: number;
}

/**
 * Validates model citations against the retrieved context and derives the
 * grounding metadata. Unknown/duplicate citations are dropped.
 */
export function groundAnswer(
  raw: RawLlmAnswer,
  context: ContextSource[],
  minScore: number = CHAT_GROUND_MIN_SCORE,
): GroundedAnswer {
  const byKey = new Map(context.map((c) => [`${c.documentId}:${c.chunkId}`, c]));
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  for (const cite of raw.citations) {
    if (typeof cite.document_id !== 'string' || typeof cite.chunk_id !== 'string') continue;
    const key = `${cite.document_id}:${cite.chunk_id}`;
    const source = byKey.get(key);
    if (!source || seen.has(key)) continue;
    seen.add(key);
    citations.push({
      documentId: source.documentId,
      chunkId: source.chunkId,
      page: typeof cite.page === 'number' ? cite.page : source.page,
      score: source.score,
    });
  }

  const topCited = citations.length > 0 ? Math.max(...citations.map((c) => c.score)) : 0;
  const grounded = citations.length > 0 && topCited >= minScore;
  const topCandidate = context.length > 0 ? Math.max(...context.map((c) => c.score)) : 0;
  const synthesis: GroundedAnswer['synthesis'] = !grounded
    ? 'fallback'
    : topCited === topCandidate
      ? 'direct'
      : 'derived';
  const confidence =
    Math.round(
      Math.min(0.97, Math.max(0.1, 0.3 + 18 * topCited + 0.1 * Math.min(3, citations.length))) *
        100,
    ) / 100;

  return {
    answer: raw.answer,
    citations,
    confidence,
    grounded,
    synthesis,
  };
}
