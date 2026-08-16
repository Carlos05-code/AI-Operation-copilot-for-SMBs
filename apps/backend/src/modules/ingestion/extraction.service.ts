/**
 * TextExtractionService: extracts raw text from uploaded bytes
 * (AI_ARCHITECTURE §4, ROADMAP Phase 2 — ingestion).
 *
 * Supported sources:
 * - `text/plain` — decoded as UTF-8.
 * - `application/pdf` — embedded text layer via `pdf-parse`; scanned PDFs
 *   (no text layer) fail with `UNSUPPORTED_DOCUMENT` until an OCR provider
 *   lands.
 *
 * Everything else is rejected with `UNSUPPORTED_DOCUMENT` (422).
 */
import { Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';

export interface ExtractionResult {
  text: string;
  pageCount?: number;
}

const UNSUPPORTED = {
  code: HttpErrorCode.UNSUPPORTED_DOCUMENT,
  status: 422,
} as const;

@Injectable()
export class TextExtractionService {
  async extract(buffer: Buffer, contentType: string | undefined): Promise<ExtractionResult> {
    if (contentType === undefined || contentType === 'text/plain') {
      return { text: buffer.toString('utf8') };
    }

    if (contentType === 'application/pdf') {
      return this.extractPdf(buffer);
    }

    throw new ApiError({
      ...UNSUPPORTED,
      message: `Unsupported content type: ${contentType}`,
    });
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractionResult> {
    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(buffer);
    } catch (error) {
      throw new ApiError({
        ...UNSUPPORTED,
        message: `Unable to parse PDF: ${(error as Error)?.message}`,
      });
    }
    const text = (parsed.text ?? '').trim();
    if (!text) {
      throw new ApiError({
        ...UNSUPPORTED,
        message: 'PDF has no text layer (scanned); OCR is not available yet',
      });
    }
    return { text, pageCount: parsed.numpages };
  }
}
