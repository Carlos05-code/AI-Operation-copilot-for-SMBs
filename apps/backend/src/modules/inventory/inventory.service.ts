/**
 * InventoryService: stock ledger, on-hand queries, and the reorder-alert
 * edge trigger (ROADMAP Phase 3 — inventory tracking with reorder alerts).
 *
 * `recordMovement` appends to the append-only `inventory_movements` ledger
 * (DATABASE_SPEC §5) and immediately re-evaluates the product's reorder
 * state, so a sale or receipt that crosses the reorder point alerts without
 * waiting for the periodic sweep (`InventoryReorderWorker`) — which exists
 * as a safety net for products whose `reorderPoint` changed without a
 * movement, or whose crossing was otherwise missed.
 *
 * The alert itself is edge-triggered on `Product.belowReorderPoint`
 * (guarded `updateMany`, same pattern as the invoice-overdue sweep): exactly
 * one `Notification` per dip below the reorder point, and the flag clears
 * automatically once stock recovers, re-arming the next dip.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { MovementType, NotificationKind, Role } from '@prisma/client';
import type { InventoryMovement } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import {
  EVENT_INVENTORY_MOVEMENT_RECORDED,
  EVENT_INVENTORY_REORDER_ALERT,
  EVENT_INVENTORY_RESTOCKED,
  MOVEMENT_MAX_QUANTITY,
  MOVEMENT_NOTE_MAX_LENGTH,
} from './inventory.constants';
import { computeStockMap, isBelowReorderPoint } from './stock';

export interface RecordMovementInput {
  organizationId: string;
  productId: string;
  type: MovementType;
  quantity: number;
  note?: string | null;
}

export interface MovementView {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  note: string | null;
  createdAt: string;
}

export interface StockView {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
  belowReorderPoint: boolean;
}

export interface ReorderAlertProduct {
  id: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
  belowReorderPoint: boolean;
  active: boolean;
}

const ALERT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /** Batch on-hand lookup; ids with no movements resolve to 0. */
  async onHandFor(productIds: readonly string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const prisma = this.requirePrisma();
    const rows = await prisma.inventoryMovement.groupBy({
      by: ['productId', 'type'],
      where: { productId: { in: [...productIds] } },
      _sum: { quantity: true },
    });
    return computeStockMap(rows);
  }

  async getStock(organizationId: string, productId: string): Promise<StockView> {
    const prisma = this.requirePrisma();
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, name: true, sku: true, reorderPoint: true, belowReorderPoint: true },
    });
    if (!product) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Product not found in this organization',
      });
    }
    const onHand = (await this.onHandFor([product.id])).get(product.id) ?? 0;
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      onHand,
      reorderPoint: product.reorderPoint ?? 0,
      belowReorderPoint: product.belowReorderPoint,
    };
  }

  /** Appends a movement and re-evaluates the reorder-alert state for its product. */
  async recordMovement(input: RecordMovementInput): Promise<MovementView> {
    const prisma = this.requirePrisma();
    const quantity = validateQuantity(input.type, input.quantity);
    const note = normalizeNote(input.note);

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId: input.organizationId },
      select: {
        id: true,
        name: true,
        sku: true,
        reorderPoint: true,
        belowReorderPoint: true,
        active: true,
      },
    });
    if (!product) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Product not found in this organization',
      });
    }

    const movement = await prisma.inventoryMovement.create({
      data: { productId: product.id, type: input.type, quantity, note },
    });

    await this.emitMovementRecorded(input.organizationId, movement);
    await this.evaluateReorderAlert(input.organizationId, product);

    return serializeMovement(movement);
  }

  async listMovements(
    organizationId: string,
    productId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: MovementView[]; total: number }> {
    const prisma = this.requirePrisma();
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Product not found in this organization',
      });
    }
    const where = { productId };
    const [rows, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryMovement.count({ where }),
    ]);
    return { items: rows.map(serializeMovement), total };
  }

  /**
   * Edge-triggers the reorder alert: flips `belowReorderPoint` (guarded, so
   * a concurrent evaluation can't double-fire) and notifies every
   * OWNER/ADMIN/MANAGER of the org exactly once per dip below the reorder
   * point; clears silently once stock recovers. `recipientsCache` lets a
   * batch caller (the sweep worker) resolve each org's recipients once.
   */
  async evaluateReorderAlert(
    organizationId: string,
    product: ReorderAlertProduct,
    recipientsCache?: Map<string, string[]>,
  ): Promise<'alerted' | 'restocked' | 'unchanged'> {
    const prisma = this.requirePrisma();
    const onHand = (await this.onHandFor([product.id])).get(product.id) ?? 0;
    const isLow = product.active && isBelowReorderPoint(onHand, product.reorderPoint);

    if (isLow && !product.belowReorderPoint) {
      const claimed = await prisma.product.updateMany({
        where: { id: product.id, belowReorderPoint: false },
        data: { belowReorderPoint: true },
      });
      if (claimed.count === 0) return 'unchanged';
      await this.notifyReorderAlert(organizationId, product, onHand, recipientsCache);
      return 'alerted';
    }
    if (!isLow && product.belowReorderPoint) {
      const claimed = await prisma.product.updateMany({
        where: { id: product.id, belowReorderPoint: true },
        data: { belowReorderPoint: false },
      });
      if (claimed.count === 0) return 'unchanged';
      await this.emitRestocked(organizationId, product.id, onHand);
      return 'restocked';
    }
    return 'unchanged';
  }

  private async notifyReorderAlert(
    organizationId: string,
    product: ReorderAlertProduct,
    onHand: number,
    recipientsCache?: Map<string, string[]>,
  ): Promise<void> {
    const prisma = this.requirePrisma();
    const recipients = await this.recipientsForOrg(organizationId, recipientsCache);
    if (recipients.length > 0) {
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({
          organizationId,
          userId,
          kind: NotificationKind.IN_APP,
          title: `${product.name} is below its reorder point`,
          body: `${product.sku} has ${onHand} on hand, below the reorder point of ${product.reorderPoint ?? 0}.`,
          payload: {
            productId: product.id,
            sku: product.sku,
            onHand,
            reorderPoint: product.reorderPoint ?? 0,
          },
        })),
      });
    }
    try {
      await this.outbox?.append({
        aggregateType: 'product',
        aggregateId: product.id,
        eventType: EVENT_INVENTORY_REORDER_ALERT,
        payload: { organizationId, productId: product.id, sku: product.sku, onHand },
      });
    } catch (error) {
      this.logger.warn(`reorder alert outbox append skipped: ${(error as Error)?.message}`);
    }
  }

  private async recipientsForOrg(
    organizationId: string,
    cache?: Map<string, string[]>,
  ): Promise<string[]> {
    const cached = cache?.get(organizationId);
    if (cached) return cached;
    const prisma = this.requirePrisma();
    const members = await prisma.member.findMany({
      where: { organizationId, role: { in: ALERT_ROLES } },
      select: { userId: true },
    });
    const ids = [...new Set(members.map((member) => member.userId))];
    cache?.set(organizationId, ids);
    return ids;
  }

  private async emitMovementRecorded(
    organizationId: string,
    movement: InventoryMovement,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'product',
        aggregateId: movement.productId,
        eventType: EVENT_INVENTORY_MOVEMENT_RECORDED,
        payload: {
          organizationId,
          productId: movement.productId,
          type: movement.type,
          quantity: movement.quantity,
        },
      });
    } catch (error) {
      this.logger.warn(`movement outbox append skipped: ${(error as Error)?.message}`);
    }
  }

  private async emitRestocked(
    organizationId: string,
    productId: string,
    onHand: number,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'product',
        aggregateId: productId,
        eventType: EVENT_INVENTORY_RESTOCKED,
        payload: { organizationId, productId, onHand },
      });
    } catch (error) {
      this.logger.warn(`restocked outbox append skipped: ${(error as Error)?.message}`);
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

function validateQuantity(type: MovementType, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: "'quantity' must be a non-zero integer",
    });
  }
  if (Math.abs(quantity) > MOVEMENT_MAX_QUANTITY) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'quantity' magnitude cannot exceed ${MOVEMENT_MAX_QUANTITY}`,
    });
  }
  if ((type === MovementType.IN || type === MovementType.OUT) && quantity < 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'quantity' must be positive for ${type} movements (ADJUST accepts negative corrections)`,
    });
  }
  return quantity;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MOVEMENT_NOTE_MAX_LENGTH);
}

function serializeMovement(movement: InventoryMovement): MovementView {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity,
    note: movement.note,
    createdAt: movement.createdAt.toISOString(),
  };
}
