/**
 * WorkflowsWorkerModule: the `WorkflowEngineWorker` half of
 * `workflow.module.ts`, split out so `worker-app.module.ts` never
 * instantiates `WorkflowRuleController` (DEVOPS_SPEC §3). Evaluates every
 * active rule against its org's current entities and runs matching
 * actions — deterministic, no LLM.
 */
import { Module } from '@nestjs/common';
import { WorkflowEngineWorker } from './workflow-engine.worker';

@Module({
  providers: [WorkflowEngineWorker],
})
export class WorkflowsWorkerModule {}
