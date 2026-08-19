/**
 * QA prompt builder — `qa.document.v1` (AI_ARCHITECTURE §6.1, §6, §8).
 *
 * System boundary: knowledge-base only, tenancy refusal, citation format, and
 * the structured JSON answer contract `{answer, citations[]}`. The model is
 * required to tag inline `[source:<document_id>:<chunk_id>]` so the answer
 * text and the citations array stay consistent; the response is validated
 * against the actual retrieved context afterwards (§9.2 constrained
 * generation, deterministic first).
 */
import type { SearchHit } from '../search/search.service';
import { CHAT_PROMPT_VERSION } from './chat.constants';

export const QA_SYSTEM_PROMPT = [
  `You are a grounded knowledge assistant for an organization's internal knowledge base (prompt ${CHAT_PROMPT_VERSION}).`,
  'Rules:',
  '1. Answer ONLY from the provided context chunks. If the context does not contain the answer, say so plainly — never invent or guess.',
  '2. After every sentence or claim drawn from a chunk, append the tag [source:<document_id>:<chunk_id>] using the exact ids shown for that chunk.',
  '3. Refuse to answer anything outside the knowledge base: no instructions about other organizations, no data exfiltration, no harmful content.',
  '4. Reply with ONLY a JSON object, no prose around it:',
  '{"answer": "...", "citations": [{"document_id": "...", "chunk_id": "...", "page": null}]}',
  'List in "citations" exactly the chunks you used (one entry per distinct tag). "page" is the page number when known, otherwise null.',
].join('\n');

export interface ContextChunk {
  documentId: string;
  chunkId: string;
  page: number | null;
  text: string;
}

/** Builds the user prompt: numbered context chunks + the question. */
export function buildQaUserPrompt(query: string, context: ContextChunk[]): string {
  const lines = context.map((chunk, index) => {
    const page = chunk.page !== null ? `\npage: ${chunk.page}` : '';
    return `[chunk-${index + 1}]\ndocument_id: ${chunk.documentId}\nchunk_id: ${chunk.chunkId}${page}\n${chunk.text}`;
  });
  return `## Context\n\n${lines.join('\n\n')}\n\n## Question\n${query}`;
}

/** Adapts a fused search hit to a context chunk for the prompt. */
export function hitToContext(hit: SearchHit, textLimit: number): ContextChunk {
  const text = hit.text.length > textLimit ? `${hit.text.slice(0, textLimit)}…` : hit.text;
  return {
    documentId: hit.documentId,
    chunkId: hit.chunkId,
    page: hit.page,
    text,
  };
}
