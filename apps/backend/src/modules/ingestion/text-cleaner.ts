/**
 * Text cleaning for ingested documents (AI_ARCHITECTURE §4).
 *
 * `cleanText` normalizes extracted text: Unicode normalization, control-char
 * stripping, line-ending and whitespace collapsing, and removal of page-number
 * footers when a document has three or more of them. Paragraph breaks (blank
 * lines) are preserved so the chunker can respect section boundaries.
 */
export interface CleanedText {
  text: string;
  paragraphs: number;
}

/** Matches bare page numbers / "Page N" footers. */
const PAGE_NUMBER_LINE = /^(?:\d{1,4}|page\s+\d{1,4})$/i;

export function cleanText(raw: string): CleanedText {
  let text = raw.normalize('NFKC');
  // Remove characters outside printable Unicode categories (control chars,
  // unassigned code points) while keeping line breaks and tabs.
  text = text.replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z}\n\r\t]/gu, '');
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  const lines = text.split('\n');
  const pageNumberLines = lines.filter((line) => PAGE_NUMBER_LINE.test(line.trim()));
  const stripPageNumbers = pageNumberLines.length >= 3;
  const kept = stripPageNumbers
    ? lines.filter((line) => !PAGE_NUMBER_LINE.test(line.trim()))
    : lines;

  const cleaned = kept.join('\n').trim();
  const paragraphs = cleaned.length === 0 ? 0 : cleaned.split(/\n{2,}/).length;
  return { text: cleaned, paragraphs };
}
