/**
 * Sales forecast endpoint (ROADMAP Phase 4 — sales forecasting).
 * Read-only; any authenticated member may browse; org-scoped from the
 * verified token (mirrors `DashboardController`).
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { SalesForecastService } from './sales-forecast.service';
import {
  FORECAST_MAX_HORIZON_DAYS,
  FORECAST_MAX_LOOKBACK_DAYS,
  FORECAST_MIN_HORIZON_DAYS,
  FORECAST_MIN_LOOKBACK_DAYS,
} from './sales-forecast.constants';

export class SalesForecastQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FORECAST_MIN_LOOKBACK_DAYS)
  @Max(FORECAST_MAX_LOOKBACK_DAYS)
  lookbackDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FORECAST_MIN_HORIZON_DAYS)
  @Max(FORECAST_MAX_HORIZON_DAYS)
  horizonDays?: number;
}

@ApiTags('forecasting')
@Controller('forecasting')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class SalesForecastController {
  constructor(private readonly forecasts: SalesForecastService) {}

  @Get('sales')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Revenue history + a linear-trend/day-of-week-seasonality forecast' })
  async sales(@CurrentUser() user: AuthContext, @Query() query: SalesForecastQuery) {
    const organizationId = this.requireOrganization(user);
    return this.forecasts.forecast(organizationId, query.lookbackDays, query.horizonDays);
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
