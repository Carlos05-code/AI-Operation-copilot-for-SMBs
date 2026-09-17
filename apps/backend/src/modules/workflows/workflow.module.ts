/**
 * WorkflowsModule: org-defined automation rule CRUD (ROADMAP Phase 4 —
 * visual workflow builder / rules engine, stretch). HTTP-only —
 * `WorkflowEngineWorker` lives in `workflow-worker.module.ts`, split out so
 * `worker-app.module.ts` never instantiates `WorkflowRuleController`
 * (DEVOPS_SPEC §3). PrismaService, OutboxService, and QueueService come
 * from their global modules; every component is fail-soft when infra is
 * absent.
 */
import { Module } from '@nestjs/common';
import { WorkflowRuleController } from './workflow-rule.controller';
import { WorkflowRuleService } from './workflow-rule.service';

@Module({
  controllers: [WorkflowRuleController],
  providers: [WorkflowRuleService],
  exports: [WorkflowRuleService],
})
export class WorkflowsModule {}
