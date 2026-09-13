/**
 * InventoryModule: product catalog, stock ledger, and reorder alerts
 * (ROADMAP Phase 3, DATABASE_SPEC §5).
 *
 * Surfaces `/products` (CRUD + nested `:id/stock` and `:id/movements`) and
 * `/inventory/sweep-reorder-alerts`. `InventoryReorderWorker` runs the
 * periodic safety-net sweep on the shared `ops-jobs` queue; most alerts fire
 * immediately from `InventoryService.recordMovement`/`ProductService.update`
 * instead. PrismaService, OutboxService, and QueueService come from their
 * global modules; every component is fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryReorderWorker } from './inventory.reorder.worker';
import { InventoryService } from './inventory.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

@Module({
  controllers: [ProductController, InventoryController],
  providers: [ProductService, InventoryService, InventoryReorderWorker],
  exports: [ProductService, InventoryService],
})
export class InventoryModule {}
