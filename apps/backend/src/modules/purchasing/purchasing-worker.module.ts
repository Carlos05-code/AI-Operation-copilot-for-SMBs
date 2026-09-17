/**
 * PurchasingWorkerModule: the `PurchaseRecommendationWorker` half of
 * `purchasing.module.ts`, split out so `worker-app.module.ts` never
 * instantiates `PurchaseRecommendationController` (DEVOPS_SPEC §3). Collects
 * every below-reorder-point product, runs the `recommend.reorder.v1` prompt
 * through the shared LLM per org, and persists validated recommendations
 * (deduped against any still-`PENDING` row for the same product).
 */
import { Module } from '@nestjs/common';
import { LlmModule } from '../chat/llm.module';
import { PurchaseRecommendationWorker } from './purchase-recommendation.worker';

@Module({
  imports: [LlmModule],
  providers: [PurchaseRecommendationWorker],
})
export class PurchasingWorkerModule {}
