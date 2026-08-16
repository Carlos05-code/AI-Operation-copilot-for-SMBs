/**
 * Unit tests — text cleaning (AI_ARCHITECTURE §4).
 */
import { cleanText } from './text-cleaner';

describe('cleanText', () => {
  it('normalizes unicode and strips control characters', () => {
    const { text } = cleanText('ＡＢＣ \u0000\u0002\nhello\u007F world');
    expect(text).toBe('ABC\nhello world');
  });

  it('normalizes line endings and collapses excess blank lines', () => {
    const { text } = cleanText('a\r\nb\r\n\r\n\r\n\r\nc');
    expect(text).toBe('a\nb\n\nc');
  });

  it('preserves paragraph breaks', () => {
    const { text, paragraphs } = cleanText('para one\n\npara two\n\npara three');
    expect(text).toBe('para one\n\npara two\n\npara three');
    expect(paragraphs).toBe(3);
  });

  it('removes page-number footers across pages', () => {
    const { text } = cleanText('1\nintro\n2\nbody\n3\noutro');
    expect(text).toBe('intro\nbody\noutro');
  });

  it('keeps a lone page number when the document has fewer than three', () => {
    const { text } = cleanText('cover\n1\nintro');
    expect(text).toBe('cover\n1\nintro');
  });

  it('keeps legitimate repeated text and returns zero paragraphs for empty input', () => {
    const { text, paragraphs } = cleanText('Total: 100\nTotal: 200\nTotal: 300');
    expect(text).toBe('Total: 100\nTotal: 200\nTotal: 300');
    expect(cleanText('   \n\n  ').paragraphs).toBe(0);
    expect(paragraphs).toBe(1);
  });
});
