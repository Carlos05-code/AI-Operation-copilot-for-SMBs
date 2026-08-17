/**
 * Text chunker for the embedding pipeline (AI_ARCHITECTURE §4).
 *
 * Rules implemented:
 * - Target 256-512 tokens per chunk (default 384) with 64-token overlap.
 * - Paragraph-aware: sections separated by blank lines are natural boundaries.
 * - Never splits mid-sentence: chunks are whole sentences only; a single
 *   sentence larger than the target is emitted as its own oversized chunk.
 */
import { CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS, TOKENS_PER_CHAR } from './embeddings.constants';

export interface TextChunk {
  index: number;
  text: string;
  tokens: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

/** Rough token estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * TOKENS_PER_CHAR));
}

/** Splits text into sentence/paragraph units, preserving sentence integrity. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Returns the tail of `text` used as the overlap for the next chunk. */
export function overlapTail(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0 || !text) return '';
  const window = text.slice(-(overlapTokens * 4));
  const cut = lastBoundaryIndex(window);
  if (cut > window.length * 0.5) return window.slice(cut + 1).trim();
  const space = window.lastIndexOf(' ');
  return (space > 0 ? window.slice(space + 1) : window).trim();
}

/** Last sentence/line boundary that is not the very last character. */
function lastBoundaryIndex(window: string): number {
  for (let i = window.length - 2; i >= 0; i -= 1) {
    const ch = window[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') return i;
  }
  return -1;
}

/** Chunks cleaned document text into overlap-aware, sentence-aligned units. */
export function chunkText(raw: string, options: ChunkOptions = {}): TextChunk[] {
  const targetTokens = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapTokens = Math.min(
    options.overlapTokens ?? CHUNK_OVERLAP_TOKENS,
    Math.max(0, targetTokens - 1),
  );
  const sentences = splitSentences(raw);
  if (sentences.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current = '';
  for (const sentence of sentences) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (current && estimateTokens(joined) > targetTokens) {
      const text = current.trim();
      chunks.push({ index: chunks.length, text, tokens: estimateTokens(text) });
      current = [overlapTail(text, overlapTokens), sentence].filter(Boolean).join(' ');
    } else {
      current = joined;
    }
  }
  const text = current.trim();
  if (text) {
    chunks.push({ index: chunks.length, text, tokens: estimateTokens(text) });
  }
  return chunks;
}
