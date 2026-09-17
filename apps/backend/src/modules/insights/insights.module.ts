/**
 * InsightsModule: lists AI executive briefings (ROADMAP Phase 4,
 * AI_ARCHITECTURE §6.1 `insight.executive`). HTTP-only — the worker that
 * generates briefings lives in `insights-worker.module.ts` (DEVOPS_SPEC §3).
 * PrismaService and QueueService come from their global modules.
 */
import { Module } from '@nestjs/common';
import { ExecutiveBriefingController } from './executive-briefing.controller';
import { ExecutiveBriefingService } from './executive-briefing.service';

@Module({
  controllers: [ExecutiveBriefingController],
  providers: [ExecutiveBriefingService],
  exports: [ExecutiveBriefingService],
})
export class InsightsModule {}
