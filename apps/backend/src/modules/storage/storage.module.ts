/**
 * StorageModule: the MinIO client + `StorageService` (SECURITY_SPEC §10).
 * Global and service-only — the presigned-URL HTTP surface lives in
 * `storage-http.module.ts` so the worker process (which still needs
 * `StorageService`, e.g. for `search.worker.ts`) never instantiates
 * `StorageController` (DEVOPS_SPEC §3).
 *
 * The MinIO client is created from `STORAGE_*` env vars and is `undefined`
 * when unset — the module stays inert (fail-soft) so local runs without
 * MinIO still boot and health reports `configured`.
 */
import { Global, Module } from '@nestjs/common';
import { DEFAULT_STORAGE_BUCKET, STORAGE_CLIENT } from './storage.constants';
import { createStorageClient, storageClientConfig } from './storage.config';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_CLIENT,
      useFactory: () => {
        const config = storageClientConfig();
        return config ? createStorageClient(config) : undefined;
      },
    },
    {
      provide: StorageService,
      useFactory: (client?: import('minio').Client) =>
        new StorageService(client, process.env.STORAGE_BUCKET ?? DEFAULT_STORAGE_BUCKET),
      inject: [STORAGE_CLIENT],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
