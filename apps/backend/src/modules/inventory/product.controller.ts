/**
 * Product + movement endpoints (ROADMAP Phase 3 — inventory tracking with
 * reorder alerts). Movements and stock are nested one level under a product
 * (API_SPEC §2). Writes require agent-or-above; reads are open to any
 * member; everything is org-scoped from the verified token.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { MovementType, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import {
  MOVEMENT_MAX_QUANTITY,
  MOVEMENT_NOTE_MAX_LENGTH,
  PRODUCT_MAX_PRICE,
  PRODUCT_MAX_REORDER_POINT,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SKU_MAX_LENGTH,
} from './inventory.constants';
import { InventoryService } from './inventory.service';
import { ProductService } from './product.service';

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_SKU_MAX_LENGTH)
  sku!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(PRODUCT_MAX_PRICE)
  price!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(PRODUCT_MAX_PRICE)
  cost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MAX_REORDER_POINT)
  reorderPoint?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(PRODUCT_MAX_PRICE)
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(PRODUCT_MAX_PRICE)
  cost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MAX_REORDER_POINT)
  reorderPoint?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListProductsQuery {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  lowStock?: boolean;
}

export class ListMovementsQuery {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RecordMovementDto {
  @IsEnum(MovementType)
  type!: MovementType;

  @IsInt()
  @Min(-MOVEMENT_MAX_QUANTITY)
  @Max(MOVEMENT_MAX_QUANTITY)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(MOVEMENT_NOTE_MAX_LENGTH)
  note?: string;
}

@ApiTags('products')
@Controller('products')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly inventory: InventoryService,
  ) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Create a product' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateProductDto) {
    return this.products.create({ organizationId: this.requireOrganization(user), ...dto });
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org products, alphabetical, with computed on-hand stock' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListProductsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.products.list(organizationId, page, limit, {
      active: query.active,
      lowStock: query.lowStock,
    });
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped product with its on-hand stock' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.products.get(this.requireOrganization(user), id);
  }

  @Patch(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Update a product (sku is immutable)' })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(this.requireOrganization(user), id, dto);
  }

  @Get(':id/stock')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch a product stock snapshot' })
  async stock(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.inventory.getStock(this.requireOrganization(user), id);
  }

  @Post(':id/movements')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Record a stock movement (IN/OUT/ADJUST) for a product' })
  async recordMovement(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecordMovementDto,
  ) {
    return this.inventory.recordMovement({
      organizationId: this.requireOrganization(user),
      productId: id,
      type: dto.type,
      quantity: dto.quantity,
      note: dto.note,
    });
  }

  @Get(':id/movements')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the stock-movement ledger for a product' })
  async listMovements(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query() query: ListMovementsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.inventory.listMovements(organizationId, id, page, limit);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  private requireOrganization(user: AuthContext | undefined): string {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    return organizationId;
  }
}
