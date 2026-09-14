/**
 * PurchasingModule: AI-driven purchase recommendations (ROADMAP Phase 3,
 * AI_ARCHITECTURE §6.1 `recommend.reorder`).
 *
 * `POST /purchasing/recommendations/sweep` schedules a
 * `purchase.recommend.sweep` job on the shared `ai-jobs` queue;
 * `PurchaseRecommendationWorker` collects every below-reorder-point product,
 * runs the `recommend.reorder.v1` prompt through the shared LLM per org, and
 * persists validated recommendations (deduped against any still-`PENDING`
 * row for the same product). PrismaService, OutboxService, and QueueService
 * come from their global modules; every component is fail-soft when infra
 * is absent.
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PurchaseRecommendationController } from './purchase-recommendation.controller';
import { PurchaseRecommendationService } from './purchase-recommendation.service';
import { PurchaseRecommendationWorker } from './purchase-recommendation.worker';

@Module({
  imports: [ChatModule],
  controllers: [PurchaseRecommendationController],
  providers: [PurchaseRecommendationService, PurchaseRecommendationWorker],
  exports: [PurchaseRecommendationService],
})
export class PurchasingModule {}
