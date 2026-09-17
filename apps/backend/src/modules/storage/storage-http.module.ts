/**
 * StorageHttpModule: the `StorageController` half of `storage.module.ts`
 * (SECURITY_SPEC §10), split out so `worker-app.module.ts` — which still
 * needs the global `StorageService` for `search.worker.ts` — never
 * instantiates this controller (DEVOPS_SPEC §3). HTTP-only; imported by
 * `app.module.ts` alone.
 */
import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';

@Module({
  controllers: [StorageController],
})
export class StorageHttpModule {}
