/**
 * ProductService: product catalog CRUD (ROADMAP Phase 3 — inventory
 * tracking with reorder alerts, DATABASE_SPEC §5).
 *
 * Every response carries the computed `onHand` (via `InventoryService`,
 * batched across a page rather than N+1). Updating `reorderPoint` or
 * `active` re-evaluates the reorder-alert state immediately, so raising a
 * threshold above current stock (or disabling a SKU) doesn't wait for the
 * periodic sweep. `sku` is immutable after creation — the global validation
 * pipe's whitelist rejects an update body that includes it.
 */
import { Injectable, Optional } from '@nestjs/common';
import type { Prisma, Product } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { PRODUCT_NAME_MAX_LENGTH, PRODUCT_SKU_MAX_LENGTH } from './inventory.constants';
import { InventoryService } from './inventory.service';

export interface CreateProductInput {
  organizationId: string;
  name: string;
  sku: string;
  price: number;
  cost?: number | null;
  reorderPoint?: number;
  active?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  price?: number;
  cost?: number | null;
  reorderPoint?: number;
  active?: boolean;
}

export interface ProductView {
  id: string;
  name: string;
  sku: string;
  price: string;
  cost: string | null;
  reorderPoint: number;
  belowReorderPoint: boolean;
  onHand: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResult {
  items: ProductView[];
  total: number;
}

@Injectable()
export class ProductService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  async create(input: CreateProductInput): Promise<ProductView> {
    const prisma = this.requirePrisma();
    const name = requireTrimmed(input.name, 'name', PRODUCT_NAME_MAX_LENGTH);
    const sku = requireTrimmed(input.sku, 'sku', PRODUCT_SKU_MAX_LENGTH);
    const price = requireNonNegative(input.price, 'price');
    const cost =
      input.cost === undefined || input.cost === null
        ? null
        : requireNonNegative(input.cost, 'cost');
    const reorderPoint = requireNonNegativeInt(input.reorderPoint ?? 0, 'reorderPoint');

    let product: Product;
    try {
      product = await prisma.product.create({
        data: {
          organizationId: input.organizationId,
          name,
          sku,
          price,
          cost,
          reorderPoint,
          active: input.active ?? true,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError({
          code: HttpErrorCode.CONFLICT,
          status: 409,
          message: `A product with sku '${sku}' already exists in this organization`,
        });
      }
      throw error;
    }
    return this.toView(product, 0);
  }

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    opts: { active?: boolean; lowStock?: boolean } = {},
  ): Promise<ProductListResult> {
    const prisma = this.requirePrisma();
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...(opts.active !== undefined ? { active: opts.active } : {}),
      ...(opts.lowStock ? { belowReorderPoint: true } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);
    const stock = await this.requireInventory().onHandFor(rows.map((row) => row.id));
    return { items: rows.map((row) => this.toView(row, stock.get(row.id) ?? 0)), total };
  }

  async get(organizationId: string, productId: string): Promise<ProductView> {
    const product = await this.load(organizationId, productId);
    const onHand = (await this.requireInventory().onHandFor([product.id])).get(product.id) ?? 0;
    return this.toView(product, onHand);
  }

  async update(
    organizationId: string,
    productId: string,
    patch: UpdateProductInput,
  ): Promise<ProductView> {
    const prisma = this.requirePrisma();
    const existing = await this.load(organizationId, productId);

    const data: Prisma.ProductUpdateInput = {};
    if (patch.name !== undefined)
      data.name = requireTrimmed(patch.name, 'name', PRODUCT_NAME_MAX_LENGTH);
    if (patch.price !== undefined) data.price = requireNonNegative(patch.price, 'price');
    if (patch.cost !== undefined) {
      data.cost = patch.cost === null ? null : requireNonNegative(patch.cost, 'cost');
    }
    if (patch.reorderPoint !== undefined) {
      data.reorderPoint = requireNonNegativeInt(patch.reorderPoint, 'reorderPoint');
    }
    if (patch.active !== undefined) data.active = patch.active;

    const updated =
      Object.keys(data).length > 0
        ? await prisma.product.update({ where: { id: existing.id }, data })
        : existing;

    if (patch.reorderPoint !== undefined || patch.active !== undefined) {
      await this.requireInventory().evaluateReorderAlert(organizationId, {
        id: updated.id,
        name: updated.name,
        sku: updated.sku,
        reorderPoint: updated.reorderPoint,
        belowReorderPoint: updated.belowReorderPoint,
        active: updated.active,
      });
    }

    const onHand = (await this.requireInventory().onHandFor([updated.id])).get(updated.id) ?? 0;
    return this.toView(updated, onHand);
  }

  private async load(organizationId: string, productId: string): Promise<Product> {
    const prisma = this.requirePrisma();
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Product not found in this organization',
      });
    }
    return product;
  }

  private toView(product: Product, onHand: number): ProductView {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: decimalToString(product.price),
      cost: product.cost === null ? null : decimalToString(product.cost),
      reorderPoint: product.reorderPoint ?? 0,
      belowReorderPoint: product.belowReorderPoint,
      onHand,
      active: product.active,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
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

  private requireInventory(): InventoryService {
    if (!this.inventory) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.inventory;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

function requireTrimmed(value: string, field: string, maxLength: number): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' is required`,
    });
  }
  if (trimmed.length > maxLength) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' exceeds ${maxLength} characters`,
    });
  }
  return trimmed;
}

function requireNonNegative(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' must be a non-negative number`,
    });
  }
  return value;
}

function requireNonNegativeInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' must be a non-negative integer`,
    });
  }
  return value;
}

function decimalToString(value: { toFixed?: (digits?: number) => string } | number | null): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  return '0.00';
}
