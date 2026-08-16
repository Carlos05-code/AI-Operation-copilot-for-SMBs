/**
 * Unit tests — text extraction (AI_ARCHITECTURE §4).
 */
import pdfParse from 'pdf-parse';
import { TextExtractionService } from './extraction.service';

jest.mock('pdf-parse');
const pdfParseMock = pdfParse as jest.MockedFunction<typeof pdfParse>;

describe('TextExtractionService', () => {
  let service: TextExtractionService;

  beforeEach(() => {
    pdfParseMock.mockReset();
    service = new TextExtractionService();
  });

  it('decodes text/plain as UTF-8', async () => {
    const buffer = Buffer.from('héllo wörld', 'utf8');
    await expect(service.extract(buffer, 'text/plain')).resolves.toEqual({ text: 'héllo wörld' });
  });

  it('decodes a buffer without a content type as UTF-8', async () => {
    await expect(service.extract(Buffer.from('plain'), undefined)).resolves.toEqual({
      text: 'plain',
    });
  });

  it('extracts the embedded text layer of a PDF', async () => {
    pdfParseMock.mockResolvedValue({ text: '  invoice body  ', numpages: 2 } as never);
    const result = await service.extract(Buffer.from('%PDF-'), 'application/pdf');
    expect(result).toEqual({ text: 'invoice body', pageCount: 2 });
  });

  it('rejects scanned PDFs without a text layer', async () => {
    pdfParseMock.mockResolvedValue({ text: '  ', numpages: 1 } as never);
    await expect(service.extract(Buffer.from('%PDF-'), 'application/pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
      status: 422,
    });
  });

  it('maps pdf-parse failures to UNSUPPORTED_DOCUMENT', async () => {
    pdfParseMock.mockRejectedValue(new Error('corrupt pdf'));
    await expect(service.extract(Buffer.from('garbage'), 'application/pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
      status: 422,
    });
  });

  it('rejects unsupported content types', async () => {
    await expect(service.extract(Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
      status: 422,
    });
  });
});
