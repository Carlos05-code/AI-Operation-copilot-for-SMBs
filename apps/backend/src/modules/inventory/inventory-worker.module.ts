/**
 * InventoryWorkerModule: the `InventoryReorderWorker` half of
 * `inventory.module.ts`, split out so `worker-app.module.ts` never
 * instantiates `ProductController`/`InventoryController` (DEVOPS_SPEC §3).
 * Runs the periodic reorder-alert safety-net sweep on the shared `ops-jobs`
 * queue.
 */
import { Module } from '@nestjs/common';
import { InventoryReorderWorker } from './inventory.reorder.worker';
import { InventoryService } from './inventory.service';

@Module({
  providers: [InventoryService, InventoryReorderWorker],
})
export class InventoryWorkerModule {}
