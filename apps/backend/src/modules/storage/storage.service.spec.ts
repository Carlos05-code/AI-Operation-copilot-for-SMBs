/**
 * Unit tests — StorageService presign delegation and fail-soft behavior.
 */
import { Readable } from 'node:stream';
import type { Client } from 'minio';
import { ApiError } from '../../shared/errors/error-contract';
import { sanitizeFilename, StorageService } from './storage.service';

function mockClient(): {
  presignedPutObject: jest.Mock<Promise<string>, [string, string, number]>;
  presignedGetObject: jest.Mock<Promise<string>, [string, string, number]>;
} {
  return {
    presignedPutObject: jest.fn(),
    presignedGetObject: jest.fn(),
  };
}

describe('StorageService', () => {
  describe('when a client is configured', () => {
    it('issues a presigned upload URL with an opaque org-scoped key', async () => {
      const client = mockClient();
      client.presignedPutObject.mockResolvedValue('https://minio/upload?X-Amz-Signature=abc');
      const service = new StorageService(client as unknown as Client, 'smb-copilot');
      const receipt = await service.presignUpload({
        organizationId: 'org-1',
        filename: '../../invoice.pdf',
        contentType: 'application/pdf',
      });
      expect(client.presignedPutObject).toHaveBeenCalledWith(
        'smb-copilot',
        expect.any(String),
        3600,
      );
      const key = client.presignedPutObject.mock.calls[0]?.[1];
      expect(key).toMatch(/^org-1\/[0-9a-f-]{36}$/);
      expect(receipt.uploadUrl).toContain('X-Amz-Signature');
      expect(receipt.objectKey).toBe(key);
      expect(receipt.filename).toBe('invoice.pdf');
      expect(receipt.contentType).toBe('application/pdf');
      expect(receipt.expiresIn).toBe(3600);
    });

    it('issues a presigned download URL for an existing key', async () => {
      const client = mockClient();
      client.presignedGetObject.mockResolvedValue('https://minio/get?X-Amz-Signature=def');
      const service = new StorageService(client as unknown as Client, 'smb-copilot');
      const receipt = await service.presignDownload('org-1/00000000-0000-0000-0000-000000000000');
      expect(client.presignedGetObject).toHaveBeenCalledWith(
        'smb-copilot',
        'org-1/00000000-0000-0000-0000-000000000000',
        300,
      );
      expect(receipt.downloadUrl).toContain('X-Amz-Signature');
      expect(receipt.expiresIn).toBe(300);
    });

    it('maps client failures to STORAGE_UNAVAILABLE', async () => {
      const client = mockClient();
      client.presignedPutObject.mockRejectedValue(new Error('connection refused'));
      const service = new StorageService(client as unknown as Client);
      await expect(
        service.presignUpload({ organizationId: 'org-1', filename: 'a.pdf' }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    });
  });

  describe('without a configured client', () => {
    it('reports isConfigured false and throws STORAGE_UNAVAILABLE on use', async () => {
      const service = new StorageService(undefined);
      expect(service.isConfigured).toBe(false);
      const call = service.presignUpload({ organizationId: 'org-1', filename: 'a.pdf' });
      await expect(call).rejects.toBeInstanceOf(ApiError);
      await expect(call).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    });
  });
});

describe('sanitizeFilename', () => {
  it('strips path separators and unsafe characters', () => {
    expect(sanitizeFilename('../../invoice 2026.pdf')).toBe('invoice_2026.pdf');
  });

  it('falls back to a neutral name when nothing survives', () => {
    expect(sanitizeFilename('...')).toBe('file');
  });
});

function mockObjectClient(): { getObject: jest.Mock; putObject: jest.Mock } {
  return { getObject: jest.fn(), putObject: jest.fn() };
}

describe('server-side object access', () => {
  it('collects a stream into a buffer via getObject', async () => {
    const client = mockObjectClient();
    client.getObject.mockResolvedValue(
      Readable.from([Buffer.from('hello '), Buffer.from('world')]),
    );
    const service = new StorageService(client as unknown as Client, 'smb-copilot');
    const buffer = await service.getObject('org-1/k');
    expect(client.getObject).toHaveBeenCalledWith('smb-copilot', 'org-1/k');
    expect(buffer.toString('utf8')).toBe('hello world');
  });

  it('delegates putObject with size and content type', async () => {
    const client = mockObjectClient();
    client.putObject.mockResolvedValue({ etag: 'x' });
    const service = new StorageService(client as unknown as Client, 'smb-copilot');
    await service.putObject('org-1/k', Buffer.from('data'), 'text/plain');
    expect(client.putObject).toHaveBeenCalledWith('smb-copilot', 'org-1/k', expect.any(Buffer), 4, {
      'Content-Type': 'text/plain',
    });
  });

  it('maps getObject failures to STORAGE_UNAVAILABLE', async () => {
    const client = mockObjectClient();
    client.getObject.mockRejectedValue(new Error('no such key'));
    const service = new StorageService(client as unknown as Client);
    await expect(service.getObject('org-1/missing')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      status: 503,
    });
  });
});
