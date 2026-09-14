/**
 * Purchase recommendation endpoints (ROADMAP Phase 3 — purchase
 * recommendations). Reads are open to any member; resolving a recommendation
 * (order/dismiss) requires agent-or-above; the manual sweep trigger requires
 * manager-or-above (mirrors `/invoices/sweep-overdue`). Everything is
 * org-scoped from the verified token.
 */
import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { PurchaseRecommendationStatus, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { PurchaseRecommendationService } from './purchase-recommendation.service';

export class ListRecommendationsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(PurchaseRecommendationStatus)
  status?: PurchaseRecommendationStatus;
}

@ApiTags('purchasing')
@Controller('purchasing/recommendations')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class PurchaseRecommendationController {
  constructor(private readonly recommendations: PurchaseRecommendationService) {}

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org purchase recommendations, pending first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRecommendationsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.recommendations.list(organizationId, page, limit, {
      status: query.status,
    });
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped purchase recommendation' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.recommendations.get(this.requireOrganization(user), id);
  }

  @Post(':id/order')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Mark a recommendation as ordered' })
  async order(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.recommendations.markOrdered(this.requireOrganization(user), id);
  }

  @Post(':id/dismiss')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Dismiss a recommendation' })
  async dismiss(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.recommendations.dismiss(this.requireOrganization(user), id);
  }

  @Post('sweep')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the AI purchase-recommendation sweep job' })
  async sweep(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    await this.recommendations.requestRecommend();
    return { sweepStatus: 'QUEUED' };
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
