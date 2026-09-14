/**
 * TasksModule: AI task planning + org task surface (ROADMAP Phase 3,
 * API_SPEC §11.11; Phase 4 — low-risk task auto-completion).
 *
 * `POST /tasks/plan` schedules a `task.plan` job on the shared `ai-jobs`
 * queue; TaskPlanningWorker collects deterministic signals (overdue invoices,
 * low stock), runs the `plan.tasks.v1` prompt through the shared LLM, and
 * persists validated tasks with `agentMetadata` (deduped by signal key).
 * `POST /tasks/sweep-autocomplete` schedules a `task.autocomplete.sweep` job
 * on the shared `ops-jobs` queue; TaskAutoCompletionWorker deterministically
 * completes an AI-planned task once its linked signal (invoice/product) has
 * verifiably resolved, notifying a human either way. Fail-soft: no
 * LLM/database means a job skips, never fails.
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { TaskAutoCompletionWorker } from './task.autocomplete.worker';
import { TaskController } from './task.controller';
import { TaskPlanningWorker } from './task.planning.worker';
import { TaskService } from './task.service';

@Module({
  imports: [ChatModule],
  controllers: [TaskController],
  providers: [TaskService, TaskPlanningWorker, TaskAutoCompletionWorker],
  exports: [TaskService],
})
export class TasksModule {}
