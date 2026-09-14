/**
 * ExecutiveBriefingService: org-scoped read surface + generation trigger
 * (ROADMAP Phase 4 — executive insights briefings).
 *
 * `requestGenerate` enqueues an `insight.executive.briefing` job on the
 * shared `ai-jobs` queue (fire-and-forget, fail-soft — a Redis outage never
 * fails the request), scoped to the caller's org — mirrors
 * `TaskService.requestPlan`.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ExecutiveBriefing } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { JOB_EXECUTIVE_BRIEFING } from './executive-briefing.constants';

export interface ListBriefingsResult {
  items: ExecutiveBriefing[];
  total: number;
}

@Injectable()
export class ExecutiveBriefingService {
  private readonly logger = new Logger(ExecutiveBriefingService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  async list(organizationId: string, page = 1, limit = 20): Promise<ListBriefingsResult> {
    const prisma = this.requirePrisma();
    const where = { organizationId };
    const [items, total] = await Promise.all([
      prisma.executiveBriefing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.executiveBriefing.count({ where }),
    ]);
    return { items, total };
  }

  async get(organizationId: string, id: string): Promise<ExecutiveBriefing> {
    const prisma = this.requirePrisma();
    const briefing = await prisma.executiveBriefing.findFirst({ where: { id, organizationId } });
    if (!briefing) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Executive briefing not found',
      });
    }
    return briefing;
  }

  async latest(organizationId: string): Promise<ExecutiveBriefing> {
    const prisma = this.requirePrisma();
    const briefing = await prisma.executiveBriefing.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!briefing) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'No executive briefing has been generated yet',
      });
    }
    return briefing;
  }

  /** Schedules a fresh briefing for the org (fire-and-forget). */
  async requestGenerate(organizationId: string): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue(QUEUE_AI_JOBS, JOB_EXECUTIVE_BRIEFING, { organizationId });
    } catch (error) {
      this.logger.warn(`executive briefing enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}
