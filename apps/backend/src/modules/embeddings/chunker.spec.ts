/**
 * Unit tests — chunker heuristics (AI_ARCHITECTURE §4).
 */
import { chunkText, estimateTokens, overlapTail, splitSentences } from './chunker';

const sentence = (words = 10, seed = 0): string => {
  const text = Array.from({ length: words }, (_, i) => `word${seed}-${i}`).join(' ');
  return `${text}.`;
};

describe('splitSentences', () => {
  it('normalizes CRLF and trims parts', () => {
    expect(splitSentences('a.\r\n\r\nb!')).toEqual(['a.', 'b!']);
  });

  it('splits on sentence punctuation and blank lines', () => {
    expect(splitSentences('one. two! three?\n\nfour.')).toEqual([
      'one.',
      'two!',
      'three?',
      'four.',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('estimateTokens', () => {
  it('approximates 4 characters per token', () => {
    expect(estimateTokens('a'.repeat(8))).toBe(2);
    expect(estimateTokens('')).toBe(1);
  });
});

describe('overlapTail', () => {
  it('returns an empty tail without overlap', () => {
    expect(overlapTail('some text.', 0)).toBe('');
  });

  it('cuts at the last sentence boundary inside the window', () => {
    const text = 'alpha beta gamma. delta epsilon zeta. eta theta.';
    expect(overlapTail(text, 8)).toBe('eta theta.');
  });
});

describe('chunkText', () => {
  it('returns no chunks for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n  \n')).toEqual([]);
  });

  it('keeps a short text as a single chunk', () => {
    const chunks = chunkText('Hello world. This is short.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('Hello world. This is short.');
    expect(chunks[0]?.index).toBe(0);
  });

  it('splits long text into sentence-aligned chunks within the token target', () => {
    const text = Array.from({ length: 24 }, (_, i) => sentence(40, i)).join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(384);
      expect(chunk.text.endsWith('.')).toBe(true);
    }
  });

  it('carries an overlap tail from the previous chunk', () => {
    const text = Array.from({ length: 24 }, (_, i) => sentence(40, i)).join(' ');
    const chunks = chunkText(text);
    let previous: string | undefined;
    for (const chunk of chunks) {
      if (previous) {
        const tail = overlapTail(previous, 64);
        expect(chunk.text.startsWith(tail)).toBe(true);
        expect(tail).not.toBe('');
      }
      previous = chunk.text;
    }
  });

  it('does not split a single oversized sentence', () => {
    const big = sentence(500, 1);
    const chunks = chunkText(`${big} ${sentence(3, 2)}`);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain(big);
    expect(chunks[0]?.tokens).toBeGreaterThan(384);
  });

  it('respects custom target and overlap options', () => {
    const text = Array.from({ length: 30 }, (_, i) => sentence(8, i)).join(' ');
    const chunks = chunkText(text, { targetTokens: 32, overlapTokens: 8 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(32);
    }
  });
});
