/**
 * InsightsWorkerModule: the `ExecutiveBriefingWorker` half of
 * `insights.module.ts`, split out so `worker-app.module.ts` never
 * instantiates `ExecutiveBriefingController` (DEVOPS_SPEC §3).
 * `ExecutiveBriefingWorker` collects one KPI snapshot (revenue,
 * receivables, tasks, inventory, purchase recommendations, upcoming
 * appointments, unread alerts), runs the `insight.executive.v1` prompt
 * through the shared LLM, and persists the validated briefing.
 */
import { Module } from '@nestjs/common';
import { LlmModule } from '../chat/llm.module';
import { ExecutiveBriefingWorker } from './executive-briefing.worker';

@Module({
  imports: [LlmModule],
  providers: [ExecutiveBriefingWorker],
})
export class InsightsWorkerModule {}
