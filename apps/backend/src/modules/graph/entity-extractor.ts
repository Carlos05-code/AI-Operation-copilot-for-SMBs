/**
 * EntityExtractor: deterministic, LLM-free entity extraction from chunk text
 * (AI_ARCHITECTURE §5, DATABASE_SPEC §4).
 *
 * Extraction is deliberately conservative: emails, URLs, ALL-CAPS acronyms,
 * and capitalized multi-word phrases (honorific-prefixed ones become
 * `person`). Canonicals are lowercased and deduplicated so retrieval matches
 * regardless of capitalization. This runs on plain regexes — no model calls —
 * which keeps the pipeline fail-soft and offline-testable. LLM-assisted NER
 * can replace this later without changing the graph model.
 */
import { MAX_ENTITIES_PER_CHUNK, MAX_ENTITY_LENGTH } from './graph.constants';

export type EntityKind = 'person' | 'organization' | 'email' | 'url' | 'acronym';

export interface ExtractedEntity {
  canonical: string;
  kind: EntityKind;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const ACRONYM_RE = /\b[A-Z]{2,5}\b/g;
const NAME_RE = /\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})+\b/g;

/** Words that start generic sentences; phrases beginning with them are noise. */
const SENTENCE_STARTERS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'our',
  'their',
  'your',
  'its',
  'and',
  'but',
  'for',
  'with',
  'from',
  'into',
  'over',
  'under',
  'upon',
  'when',
  'where',
  'which',
  'while',
  'after',
  'before',
  'during',
  'between',
]);

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'miss', 'sir', 'madam']);

/**
 * Extracts entities from a text block. Returns deduplicated entities capped
 * at `limit` (most common extraction first, stable order).
 */
export function extractEntities(
  text: string,
  limit: number = MAX_ENTITIES_PER_CHUNK,
): ExtractedEntity[] {
  const found = new Map<string, ExtractedEntity>();
  const add = (canonical: string, kind: EntityKind): void => {
    const key = canonical.toLowerCase();
    if (key.length > MAX_ENTITY_LENGTH || key.length === 0) return;
    if (!found.has(key)) {
      found.set(key, { canonical: key, kind });
    }
  };

  for (const match of text.matchAll(EMAIL_RE)) {
    add(match[0], 'email');
  }
  for (const match of text.matchAll(URL_RE)) {
    add(stripTrailingPunctuation(match[0]), 'url');
  }
  for (const match of text.matchAll(ACRONYM_RE)) {
    add(match[0], 'acronym');
  }
  for (const match of text.matchAll(NAME_RE)) {
    const phrase = stripTrailingPunctuation(match[0]);
    const words = phrase.split(' ');
    const first = words[0]?.toLowerCase() ?? '';
    if (SENTENCE_STARTERS.has(first)) continue;
    if (HONORIFICS.has(first)) {
      const rest = words.slice(1).join(' ');
      if (rest) add(rest, 'person');
      continue;
    }
    add(phrase, 'organization');
  }

  return [...found.values()].slice(0, limit);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/, '');
}
