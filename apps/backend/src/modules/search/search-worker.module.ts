/**
 * SearchWorkerModule: the `SearchWorker` half of `search.module.ts`, split
 * out so `worker-app.module.ts` never instantiates `SearchController`
 * (DEVOPS_SPEC §3). `StorageService` comes from the global `StorageModule`.
 */
import { Module } from '@nestjs/common';
import { createSearchService } from './search.config';
import { SearchService } from './search.service';
import { SearchWorker } from './search.worker';

@Module({
  providers: [{ provide: SearchService, useFactory: createSearchService }, SearchWorker],
})
export class SearchWorkerModule {}
