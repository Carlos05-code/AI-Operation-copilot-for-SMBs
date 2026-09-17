/**
 * InventoryModule: product catalog + stock ledger (ROADMAP Phase 3,
 * DATABASE_SPEC §5). HTTP-only — the reorder-alert sweep worker lives in
 * `inventory-worker.module.ts` (DEVOPS_SPEC §3). Surfaces `/products` (CRUD +
 * nested `:id/stock` and `:id/movements`) and `/inventory/sweep-reorder-
 * alerts`; most alerts actually fire immediately from
 * `InventoryService.recordMovement`/`ProductService.update` rather than the
 * sweep. PrismaService, OutboxService, and QueueService come from their
 * global modules; every component is fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

@Module({
  controllers: [ProductController, InventoryController],
  providers: [ProductService, InventoryService],
  exports: [ProductService, InventoryService],
})
export class InventoryModule {}
