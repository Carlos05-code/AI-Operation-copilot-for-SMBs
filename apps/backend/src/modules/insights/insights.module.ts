/**
 * InsightsModule: AI executive briefings (ROADMAP Phase 4, AI_ARCHITECTURE
 * §6.1 `insight.executive`).
 *
 * `POST /insights/briefings/generate` schedules an `insight.executive.briefing`
 * job on the shared `ai-jobs` queue; `ExecutiveBriefingWorker` collects one
 * KPI snapshot (revenue, receivables, tasks, inventory, purchase
 * recommendations, upcoming appointments, unread alerts), runs the
 * `insight.executive.v1` prompt through the shared LLM, and persists the
 * validated briefing. PrismaService, OutboxService, and QueueService come
 * from their global modules; every component is fail-soft when infra is
 * absent.
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ExecutiveBriefingController } from './executive-briefing.controller';
import { ExecutiveBriefingService } from './executive-briefing.service';
import { ExecutiveBriefingWorker } from './executive-briefing.worker';

@Module({
  imports: [ChatModule],
  controllers: [ExecutiveBriefingController],
  providers: [ExecutiveBriefingService, ExecutiveBriefingWorker],
  exports: [ExecutiveBriefingService],
})
export class InsightsModule {}
