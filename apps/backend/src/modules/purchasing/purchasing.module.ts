/**
 * PurchasingModule: lists AI-driven purchase recommendations (ROADMAP
 * Phase 3, AI_ARCHITECTURE §6.1 `recommend.reorder`). HTTP-only — the worker
 * that generates recommendations lives in `purchasing-worker.module.ts`
 * (DEVOPS_SPEC §3). PrismaService and QueueService come from their global
 * modules.
 */
import { Module } from '@nestjs/common';
import { PurchaseRecommendationController } from './purchase-recommendation.controller';
import { PurchaseRecommendationService } from './purchase-recommendation.service';

@Module({
  controllers: [PurchaseRecommendationController],
  providers: [PurchaseRecommendationService],
  exports: [PurchaseRecommendationService],
})
export class PurchasingModule {}
