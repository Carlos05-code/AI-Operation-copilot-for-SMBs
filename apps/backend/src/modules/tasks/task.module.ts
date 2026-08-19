/**
 * TasksModule: AI task planning + org task surface (ROADMAP Phase 3,
 * API_SPEC §11.11).
 *
 * `POST /tasks/plan` schedules a `task.plan` job on the shared `ai-jobs`
 * queue; TaskPlanningWorker collects deterministic signals (overdue invoices,
 * low stock), runs the `plan.tasks.v1` prompt through the shared LLM, and
 * persists validated tasks with `agentMetadata` (deduped by signal key).
 * Fail-soft: no LLM/database means the job skips, never fails.
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { TaskController } from './task.controller';
import { TaskPlanningWorker } from './task.planning.worker';
import { TaskService } from './task.service';

@Module({
  imports: [ChatModule],
  controllers: [TaskController],
  providers: [TaskService, TaskPlanningWorker],
  exports: [TaskService],
})
export class TasksModule {}
