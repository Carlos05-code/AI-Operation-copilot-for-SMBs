/**
 * TasksWorkerModule: the two workers from `task.module.ts`, split out so
 * `worker-app.module.ts` never instantiates `TaskController`
 * (DEVOPS_SPEC §3). `TaskPlanningWorker` collects deterministic signals
 * (overdue invoices, low stock), runs the `plan.tasks.v1` prompt through the
 * shared LLM, and persists validated tasks with `agentMetadata` (deduped by
 * signal key). `TaskAutoCompletionWorker` deterministically completes an
 * AI-planned task once its linked signal (invoice/product) has verifiably
 * resolved, notifying a human either way. Fail-soft: no LLM/database means a
 * job skips, never fails.
 */
import { Module } from '@nestjs/common';
import { LlmModule } from '../chat/llm.module';
import { TaskAutoCompletionWorker } from './task.autocomplete.worker';
import { TaskPlanningWorker } from './task.planning.worker';

@Module({
  imports: [LlmModule],
  providers: [TaskPlanningWorker, TaskAutoCompletionWorker],
})
export class TasksWorkerModule {}
