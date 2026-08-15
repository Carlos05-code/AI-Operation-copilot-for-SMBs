/**
 * Storage constants (ADR-0007, SECURITY_SPEC §10).
 */
/** DI token for the optional `Minio.Client` instance. */
export const STORAGE_CLIENT = 'STORAGE_CLIENT';

export const DEFAULT_STORAGE_BUCKET = 'smb-copilot';

/** Presigned upload URLs remain valid for one hour. */
export const PRESIGN_UPLOAD_EXPIRY_S = 3600;

/** Presigned download URLs remain valid for five minutes. */
export const PRESIGN_DOWNLOAD_EXPIRY_S = 300;
