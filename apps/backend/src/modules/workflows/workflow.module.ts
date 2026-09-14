/**
 * WorkflowsModule: org-defined automation rules (ROADMAP Phase 4 — visual
 * workflow builder / rules engine, stretch).
 *
 * `POST /workflows/rules` defines a rule (trigger entity + conditions +
 * actions); `POST /workflows/rules/sweep` schedules a `workflow.rules.sweep`
 * job on the shared `ops-jobs` queue. `WorkflowEngineWorker` evaluates every
 * active rule against its org's current entities and runs matching
 * actions — deterministic, no LLM. PrismaService, OutboxService, and
 * QueueService come from their global modules; every component is
 * fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { WorkflowEngineWorker } from './workflow-engine.worker';
import { WorkflowRuleController } from './workflow-rule.controller';
import { WorkflowRuleService } from './workflow-rule.service';

@Module({
  controllers: [WorkflowRuleController],
  providers: [WorkflowRuleService, WorkflowEngineWorker],
  exports: [WorkflowRuleService],
})
export class WorkflowsModule {}
