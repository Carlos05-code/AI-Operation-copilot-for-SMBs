/**
 * Unit tests — StorageController guards and delegation.
 */
import { StorageController } from './storage.controller';
import { ApiError } from '../../shared/errors/error-contract';
import type { AuthContext } from '../auth/auth.types';

const user: AuthContext = { userId: 'u1', organizationId: 'org-1', role: 'AGENT' };

describe('StorageController', () => {
  it('delegates uploads with the org from the token claims', async () => {
    const storage = { presignUpload: jest.fn().mockResolvedValue({ objectKey: 'org-1/k' }) };
    const controller = new StorageController(storage as never);
    await controller.presignUpload(user, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(storage.presignUpload).toHaveBeenCalledWith({
      organizationId: 'org-1',
      filename: 'a.pdf',
      contentType: 'application/pdf',
    });
  });

  it('rejects tokens without an organization claim', async () => {
    const controller = new StorageController({ presignUpload: jest.fn() } as never);
    await expect(
      controller.presignUpload({ userId: 'u1' }, { filename: 'a.pdf' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('delegates downloads to the service', async () => {
    const storage = {
      presignDownload: jest.fn().mockResolvedValue({ downloadUrl: 'https://minio/x' }),
    };
    const controller = new StorageController(storage as never);
    const receipt = await controller.presignDownload({ key: 'org-1/k' });
    expect(storage.presignDownload).toHaveBeenCalledWith('org-1/k');
    expect(receipt.downloadUrl).toBe('https://minio/x');
  });

  it('surfaces STORAGE_UNAVAILABLE from the service', async () => {
    const storage = {
      presignDownload: jest.fn().mockRejectedValue(
        new ApiError({
          code: 'STORAGE_UNAVAILABLE',
          status: 503,
          message: 'Object storage is not configured',
        }),
      ),
    };
    const controller = new StorageController(storage as never);
    await expect(controller.presignDownload({ key: 'org-1/k' })).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      status: 503,
    });
  });
});
