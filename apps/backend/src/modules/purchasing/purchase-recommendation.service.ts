/**
 * PurchaseRecommendationService: org-scoped read/action surface + sweep
 * scheduling (ROADMAP Phase 3 — purchase recommendations).
 *
 * `requestRecommend` enqueues a `purchase.recommend.sweep` job on the shared
 * `ai-jobs` queue (fire-and-forget, fail-soft — a Redis outage never fails
 * the request). `PENDING` is the only actionable status; `dismiss`/`markOrdered`
 * are terminal, mirroring the appointment/invoice lifecycle contract (an
 * illegal move is `409 CONFLICT`).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, PurchaseRecommendationStatus } from '@prisma/client';
import type { PurchaseRecommendation } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import { JOB_PURCHASE_RECOMMEND_SWEEP } from './purchase-recommendation.constants';

export interface ListRecommendationsOptions {
  status?: PurchaseRecommendationStatus;
}

export interface ListRecommendationsResult {
  items: PurchaseRecommendation[];
  total: number;
}

@Injectable()
export class PurchaseRecommendationService {
  private readonly logger = new Logger(PurchaseRecommendationService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    opts: ListRecommendationsOptions = {},
  ): Promise<ListRecommendationsResult> {
    const prisma = this.requirePrisma();
    const where: Prisma.PurchaseRecommendationWhereInput = {
      organizationId,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.purchaseRecommendation.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.purchaseRecommendation.count({ where }),
    ]);
    return { items, total };
  }

  async get(organizationId: string, id: string): Promise<PurchaseRecommendation> {
    return this.load(organizationId, id);
  }

  async dismiss(organizationId: string, id: string): Promise<PurchaseRecommendation> {
    return this.resolve(organizationId, id, PurchaseRecommendationStatus.DISMISSED);
  }

  async markOrdered(organizationId: string, id: string): Promise<PurchaseRecommendation> {
    return this.resolve(organizationId, id, PurchaseRecommendationStatus.ORDERED);
  }

  /** Schedules the AI recommendation sweep (fire-and-forget). */
  async requestRecommend(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue(QUEUE_AI_JOBS, JOB_PURCHASE_RECOMMEND_SWEEP, {});
    } catch (error) {
      this.logger.warn(`purchase recommend sweep enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private async resolve(
    organizationId: string,
    id: string,
    status: PurchaseRecommendationStatus,
  ): Promise<PurchaseRecommendation> {
    const prisma = this.requirePrisma();
    const existing = await this.load(organizationId, id);
    if (existing.status !== PurchaseRecommendationStatus.PENDING) {
      throw new ApiError({
        code: HttpErrorCode.CONFLICT,
        status: 409,
        message: `Cannot move recommendation from ${existing.status} to ${status}`,
      });
    }
    return prisma.purchaseRecommendation.update({
      where: { id: existing.id },
      data: { status, resolvedAt: new Date() },
    });
  }

  private async load(organizationId: string, id: string): Promise<PurchaseRecommendation> {
    const prisma = this.requirePrisma();
    const recommendation = await prisma.purchaseRecommendation.findFirst({
      where: { id, organizationId },
    });
    if (!recommendation) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Purchase recommendation not found',
      });
    }
    return recommendation;
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
