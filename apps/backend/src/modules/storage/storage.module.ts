/**
 * StorageModule: MinIO presigned upload/download URLs (SECURITY_SPEC §10).
 *
 * The MinIO client is created from `STORAGE_*` env vars and is `undefined`
 * when unset — the module stays inert (fail-soft) so local runs without
 * MinIO still boot and health reports `configured`.
 */
import { Global, Module } from '@nestjs/common';
import { DEFAULT_STORAGE_BUCKET, STORAGE_CLIENT } from './storage.constants';
import { createStorageClient, storageClientConfig } from './storage.config';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
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
