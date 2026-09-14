/**
 * PurchaseRecommendationWorker: consumes `purchase.recommend.sweep` jobs on
 * the shared `ai-jobs` queue (ROADMAP Phase 3 — purchase recommendations,
 * AI_ARCHITECTURE §6.1 `recommend.reorder`).
 *
 * Pipeline: collect every active, below-reorder-point product across all
 * orgs → group by org → for each org, run the `recommend.reorder.v1` prompt
 * over that org's products (on-hand, reorder point, trailing 30-day
 * consumption) → validate the JSON recommendations → create one
 * `PurchaseRecommendation` per product (skipping any product that already
 * has a `PENDING` one) → notify every OWNER/ADMIN/MANAGER of the org →
 * emit `purchase.recommended` per org.
 *
 * Fail-soft: without a database or LLM config the job is a no-op; a
 * malformed model response or any other per-org failure is logged and the
 * sweep continues with the next org (one org's LLM hiccup must never block
 * another org's recommendations). Non-matching job names are skipped.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { NotificationKind, PurchaseRecommendationStatus, Role } from '@prisma/client';
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { computeStockMap } from '../inventory/stock';
import { QUEUE_AI_JOBS } from '../queue/queue.constants';
import {
  EVENT_PURCHASE_RECOMMENDED,
  JOB_PURCHASE_RECOMMEND_SWEEP,
  PURCHASE_RECOMMEND_BATCH_SIZE,
  PURCHASE_RECOMMEND_LOOKBACK_DAYS,
  PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG,
  PURCHASE_RECOMMEND_MAX_TOKENS,
  PURCHASE_RECOMMEND_PROMPT_VERSION,
} from './purchase-recommendation.constants';
import {
  buildPurchaseRecommendUserPrompt,
  PURCHASE_RECOMMEND_SYSTEM_PROMPT,
  type PurchaseRecommendSignal,
} from './recommend.prompt';

export interface PurchaseRecommendResult {
  ran: boolean;
  skipped?: string;
  candidates: number;
  created: number;
  duplicates: number;
  notified: number;
}

interface RawRecommendation {
  productId: string;
  quantity: number;
  reason: string;
}

interface RecommendPayload {
  recommendations: RawRecommendation[];
}

interface CandidateProduct {
  id: string;
  organizationId: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
}

const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];

@Processor(QUEUE_AI_JOBS)
export class PurchaseRecommendationWorker extends WorkerHost {
  private readonly logger = new Logger(PurchaseRecommendationWorker.name);

  constructor(
    private readonly llm: LlmProvider,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {
    super();
  }

  async process(job: Job): Promise<PurchaseRecommendResult> {
    if (job.name !== JOB_PURCHASE_RECOMMEND_SWEEP) {
      return {
        ran: false,
        skipped: 'name mismatch',
        candidates: 0,
        created: 0,
        duplicates: 0,
        notified: 0,
      };
    }
    if (!this.prisma) {
      this.logger.warn('purchase recommendation sweep skipped: db not configured');
      return {
        ran: false,
        skipped: 'not configured',
        candidates: 0,
        created: 0,
        duplicates: 0,
        notified: 0,
      };
    }
    if (!this.llm.isConfigured) {
      this.logger.warn('purchase recommendation sweep skipped: llm not configured');
      return {
        ran: false,
        skipped: 'llm not configured',
        candidates: 0,
        created: 0,
        duplicates: 0,
        notified: 0,
      };
    }

    const prisma = this.prisma;
    const candidates = await prisma.product.findMany({
      where: { active: true, belowReorderPoint: true },
      take: PURCHASE_RECOMMEND_BATCH_SIZE,
      select: { id: true, organizationId: true, name: true, sku: true, reorderPoint: true },
    });
    if (candidates.length === 0) {
      return { ran: true, candidates: 0, created: 0, duplicates: 0, notified: 0 };
    }

    const byOrg = new Map<string, CandidateProduct[]>();
    for (const product of candidates) {
      const list = byOrg.get(product.organizationId) ?? [];
      list.push(product);
      byOrg.set(product.organizationId, list);
    }

    let created = 0;
    let duplicates = 0;
    let notified = 0;

    for (const [organizationId, products] of byOrg) {
      try {
        const result = await this.processOrg(organizationId, products);
        created += result.created;
        duplicates += result.duplicates;
        notified += result.notified;
      } catch (error) {
        this.logger.error(
          `purchase recommendation sweep failed for org ${organizationId}: ${(error as Error)?.message}`,
        );
      }
    }

    this.logger.log(
      `purchase recommendation sweep: ${created} created, ${duplicates} duplicates, ${notified} notifications across ${byOrg.size} orgs`,
    );
    return { ran: true, candidates: candidates.length, created, duplicates, notified };
  }

  private async processOrg(
    organizationId: string,
    products: CandidateProduct[],
  ): Promise<{ created: number; duplicates: number; notified: number }> {
    const prisma = this.prisma!;
    const scoped = products.slice(0, PURCHASE_RECOMMEND_MAX_SIGNALS_PER_ORG);
    const productIds = scoped.map((product) => product.id);
    const cutoff = new Date(Date.now() - PURCHASE_RECOMMEND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [stockSums, consumedSums] = await Promise.all([
      prisma.inventoryMovement.groupBy({
        by: ['productId', 'type'],
        where: { productId: { in: productIds } },
        _sum: { quantity: true },
      }),
      prisma.inventoryMovement.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, type: 'OUT', createdAt: { gte: cutoff } },
        _sum: { quantity: true },
      }),
    ]);
    const onHandByProduct = computeStockMap(stockSums);
    const consumedByProduct = new Map(
      consumedSums.map((row) => [row.productId, row._sum.quantity ?? 0]),
    );

    const signals: PurchaseRecommendSignal[] = scoped.map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      onHand: onHandByProduct.get(product.id) ?? 0,
      reorderPoint: product.reorderPoint ?? 0,
      consumedLast30Days: consumedByProduct.get(product.id) ?? 0,
    }));

    const content = await this.llm.complete(
      PURCHASE_RECOMMEND_SYSTEM_PROMPT,
      buildPurchaseRecommendUserPrompt(signals),
      PURCHASE_RECOMMEND_MAX_TOKENS,
    );
    const payload = parseRecommendPayload(content, new Set(productIds));
    if (!payload) {
      this.logger.warn(
        `purchase recommendation sweep: malformed model output for org ${organizationId}`,
      );
      return { created: 0, duplicates: 0, notified: 0 };
    }

    const signalById = new Map(signals.map((signal) => [signal.productId, signal]));
    const productById = new Map(scoped.map((product) => [product.id, product]));
    let created = 0;
    let duplicates = 0;
    const newlyCreated: Array<{ product: CandidateProduct; quantity: number; reason: string }> = [];

    for (const rec of payload.recommendations) {
      const existing = await prisma.purchaseRecommendation.findFirst({
        where: { productId: rec.productId, status: PurchaseRecommendationStatus.PENDING },
        select: { id: true },
      });
      if (existing) {
        duplicates += 1;
        continue;
      }
      const signal = signalById.get(rec.productId);
      const product = productById.get(rec.productId);
      if (!signal || !product) continue;
      await prisma.purchaseRecommendation.create({
        data: {
          organizationId,
          productId: rec.productId,
          recommendedQuantity: rec.quantity,
          reason: rec.reason,
          agentMetadata: {
            promptVersion: PURCHASE_RECOMMEND_PROMPT_VERSION,
            onHand: signal.onHand,
            reorderPoint: signal.reorderPoint,
            consumedLast30Days: signal.consumedLast30Days,
          },
        },
      });
      created += 1;
      newlyCreated.push({ product, quantity: rec.quantity, reason: rec.reason });
    }

    const notified = await this.notifyRecommendations(organizationId, newlyCreated);
    await this.emitRecommended(organizationId, created, duplicates);
    return { created, duplicates, notified };
  }

  private async notifyRecommendations(
    organizationId: string,
    items: Array<{ product: CandidateProduct; quantity: number; reason: string }>,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const prisma = this.prisma!;
    const members = await prisma.member.findMany({
      where: { organizationId, role: { in: ALERT_ROLES } },
      select: { userId: true },
    });
    const recipients = [...new Set(members.map((member) => member.userId))];
    if (recipients.length === 0) return 0;

    await prisma.notification.createMany({
      data: recipients.flatMap((userId) =>
        items.map((item) => ({
          organizationId,
          userId,
          kind: NotificationKind.IN_APP,
          title: `Reorder ${item.quantity} × ${item.product.name}`,
          body: item.reason,
          payload: {
            productId: item.product.id,
            sku: item.product.sku,
            recommendedQuantity: item.quantity,
          },
        })),
      ),
    });
    return recipients.length * items.length;
  }

  private async emitRecommended(
    organizationId: string,
    created: number,
    duplicates: number,
  ): Promise<void> {
    if (created === 0) return;
    try {
      await this.outbox?.append({
        aggregateType: 'organization',
        aggregateId: organizationId,
        eventType: EVENT_PURCHASE_RECOMMENDED,
        payload: { organizationId, created, duplicates },
      });
    } catch (error) {
      this.logger.warn(
        `purchase recommendation outbox append skipped: ${(error as Error)?.message}`,
      );
    }
  }
}

function parseRecommendPayload(content: string, validIds: Set<string>): RecommendPayload | null {
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<RecommendPayload>;
    if (!Array.isArray(parsed.recommendations)) return null;
    const recommendations: RawRecommendation[] = [];
    for (const raw of parsed.recommendations) {
      const rec = raw as Partial<RawRecommendation>;
      if (typeof rec.productId !== 'string' || !validIds.has(rec.productId)) continue;
      if (
        typeof rec.quantity !== 'number' ||
        !Number.isInteger(rec.quantity) ||
        rec.quantity <= 0
      ) {
        continue;
      }
      if (typeof rec.reason !== 'string' || rec.reason.trim().length === 0) continue;
      recommendations.push({
        productId: rec.productId,
        quantity: rec.quantity,
        reason: rec.reason.trim().slice(0, 500),
      });
    }
    return { recommendations };
  } catch {
    return null;
  }
}
