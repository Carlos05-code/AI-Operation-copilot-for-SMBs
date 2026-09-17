/**
 * TasksModule: org task surface (ROADMAP Phase 3, API_SPEC §11.11; Phase 4 —
 * low-risk task auto-completion). HTTP-only — `TaskPlanningWorker` and
 * `TaskAutoCompletionWorker` live in `task-worker.module.ts`, split out so
 * `worker-app.module.ts` never instantiates `TaskController`
 * (DEVOPS_SPEC §3).
 */
import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TasksModule {}
