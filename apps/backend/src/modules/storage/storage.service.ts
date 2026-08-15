/**
 * StorageService: presigned upload/download URLs for MinIO (SECURITY_SPEC §10).
 *
 * Object keys are opaque and org-scoped (`{orgId}/{uuid}`): the original
 * filename is sanitized and returned only as metadata, never used as a key.
 * URLs are short-lived; the actual S3 traffic flows browser<->MinIO directly.
 *
 * Fail-soft: without a configured client every operation throws
 * `STORAGE_UNAVAILABLE` (503) so misconfigurations surface instead of 500s.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'minio';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import {
  DEFAULT_STORAGE_BUCKET,
  PRESIGN_DOWNLOAD_EXPIRY_S,
  PRESIGN_UPLOAD_EXPIRY_S,
} from './storage.constants';

export interface PresignUploadInput {
  organizationId: string;
  filename: string;
  contentType?: string;
}

export interface StorageUploadReceipt {
  uploadUrl: string;
  objectKey: string;
  filename: string;
  contentType?: string;
  expiresIn: number;
}

export interface StorageDownloadReceipt {
  downloadUrl: string;
  objectKey: string;
  expiresIn: number;
}

/** Strips path separators and unsafe characters from a client filename. */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .split(/[\\/]/)
    .pop()
    ?.replace(/^\.+/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 255);
  return cleaned || 'file';
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Optional() private readonly client?: Client,
    private readonly bucket: string = DEFAULT_STORAGE_BUCKET,
  ) {}

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  /** Issues a presigned PUT URL for a new org-scoped object. */
  async presignUpload(input: PresignUploadInput): Promise<StorageUploadReceipt> {
    const client = this.requireClient();
    const objectKey = `${input.organizationId}/${randomUUID()}`;
    try {
      const uploadUrl = await client.presignedPutObject(
        this.bucket,
        objectKey,
        PRESIGN_UPLOAD_EXPIRY_S,
      );
      return {
        uploadUrl,
        objectKey,
        filename: sanitizeFilename(input.filename),
        contentType: input.contentType,
        expiresIn: PRESIGN_UPLOAD_EXPIRY_S,
      };
    } catch (error) {
      this.logger.error(`presign upload failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.STORAGE_UNAVAILABLE,
        status: 503,
        message: 'Object storage is unavailable',
      });
    }
  }

  /** Issues a presigned GET URL for an existing object key. */
  async presignDownload(objectKey: string): Promise<StorageDownloadReceipt> {
    const client = this.requireClient();
    try {
      const downloadUrl = await client.presignedGetObject(
        this.bucket,
        objectKey,
        PRESIGN_DOWNLOAD_EXPIRY_S,
      );
      return { downloadUrl, objectKey, expiresIn: PRESIGN_DOWNLOAD_EXPIRY_S };
    } catch (error) {
      this.logger.error(`presign download failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.STORAGE_UNAVAILABLE,
        status: 503,
        message: 'Object storage is unavailable',
      });
    }
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new ApiError({
        code: HttpErrorCode.STORAGE_UNAVAILABLE,
        status: 503,
        message: 'Object storage is not configured',
      });
    }
    return this.client;
  }
}
