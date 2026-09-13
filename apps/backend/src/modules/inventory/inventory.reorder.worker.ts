/**
 * InventoryReorderWorker: consumes `inventory.reorder.sweep` jobs on the
 * `ops-jobs` queue (ROADMAP Phase 3 — inventory tracking with reorder
 * alerts).
 *
 * Most reorder crossings are caught immediately by `InventoryService`
 * when a movement is recorded; this periodic sweep is the safety net for
 * crossings that happen without one — e.g. `reorderPoint` raised above
 * current stock, or a job missed during a Redis outage. It re-evaluates
 * every active, reorder-tracked product's edge-triggered alert state,
 * caching each org's alert recipients across the batch (`recipientsForOrg`
 * memoized once per org rather than once per product).
 *
 * Fail-soft: without a database the job is a no-op; a per-product error is
 * logged and the loop continues. Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import { JOB_INVENTORY_REORDER_SWEEP, REORDER_SWEEP_BATCH_SIZE } from './inventory.constants';
import { InventoryService } from './inventory.service';

export interface InventoryReorderJobData {
  limit?: number;
}

export interface InventoryReorderResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  alerted: number;
  restocked: number;
  failed: number;
}

@Processor(QUEUE_OPS_JOBS)
export class InventoryReorderWorker extends WorkerHost {
  private readonly logger = new Logger(InventoryReorderWorker.name);

  constructor(
    private readonly inventory: InventoryService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    super();
  }

  async process(job: Job<InventoryReorderJobData>): Promise<InventoryReorderResult> {
    if (job.name !== JOB_INVENTORY_REORDER_SWEEP) {
      return {
        ran: false,
        skipped: 'name mismatch',
        candidates: 0,
        alerted: 0,
        restocked: 0,
        failed: 0,
      };
    }
    if (!this.prisma) {
      this.logger.warn('inventory reorder sweep skipped: db not configured');
      return {
        ran: false,
        skipped: 'not configured',
        candidates: 0,
        alerted: 0,
        restocked: 0,
        failed: 0,
      };
    }

    const limit = clampLimit(job.data?.limit);
    const candidates = await this.prisma.product.findMany({
      where: { active: true, reorderPoint: { gt: 0 } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        name: true,
        sku: true,
        reorderPoint: true,
        belowReorderPoint: true,
        active: true,
      },
    });
    if (candidates.length === 0) {
      return { ran: true, candidates: 0, alerted: 0, restocked: 0, failed: 0 };
    }

    const recipientsCache = new Map<string, string[]>();
    let alerted = 0;
    let restocked = 0;
    let failed = 0;
    for (const product of candidates) {
      try {
        const outcome = await this.inventory.evaluateReorderAlert(
          product.organizationId,
          product,
          recipientsCache,
        );
        if (outcome === 'alerted') alerted += 1;
        else if (outcome === 'restocked') restocked += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `reorder evaluation failed for product ${product.id}: ${(error as Error)?.message}`,
        );
      }
    }

    this.logger.log(
      `inventory reorder sweep: ${alerted} alerted, ${restocked} restocked, ${failed} failed of ${candidates.length} candidates`,
    );
    return { ran: true, candidates: candidates.length, alerted, restocked, failed };
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return REORDER_SWEEP_BATCH_SIZE;
  }
  return Math.min(Math.trunc(limit), REORDER_SWEEP_BATCH_SIZE);
}
