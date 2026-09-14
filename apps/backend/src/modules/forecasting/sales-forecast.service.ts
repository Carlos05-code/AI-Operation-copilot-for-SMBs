/**
 * SalesForecastService: org-scoped revenue forecast (ROADMAP Phase 4 —
 * sales forecasting, PROJECT_SPEC §7.7).
 *
 * Reuses the dashboard's revenue convention — `PAID` invoice totals — bucketed
 * into UTC calendar days over `[now - lookbackDays, now)` (today is excluded
 * as an incomplete day) and projected forward with the pure linear-trend +
 * day-of-week-seasonality model in `forecast.ts`. No LLM: the roadmap calls
 * for "a simple, transparent forecast", not a black box.
 */
import { Injectable, Optional } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { addUtcDays, bucketDailyRevenue, buildSalesForecast, startOfUtcDay } from './forecast';
import type { SalesForecastResult } from './forecast';
import {
  FORECAST_DEFAULT_HORIZON_DAYS,
  FORECAST_DEFAULT_LOOKBACK_DAYS,
  FORECAST_MAX_HORIZON_DAYS,
  FORECAST_MAX_LOOKBACK_DAYS,
  FORECAST_MIN_HORIZON_DAYS,
  FORECAST_MIN_LOOKBACK_DAYS,
} from './sales-forecast.constants';

export interface SalesForecastView extends SalesForecastResult {
  generatedAt: string;
  lookbackDays: number;
  horizonDays: number;
}

@Injectable()
export class SalesForecastService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async forecast(
    organizationId: string,
    lookbackDays = FORECAST_DEFAULT_LOOKBACK_DAYS,
    horizonDays = FORECAST_DEFAULT_HORIZON_DAYS,
  ): Promise<SalesForecastView> {
    const prisma = this.requirePrisma();
    const clampedLookback = clamp(
      lookbackDays,
      FORECAST_MIN_LOOKBACK_DAYS,
      FORECAST_MAX_LOOKBACK_DAYS,
    );
    const clampedHorizon = clamp(horizonDays, FORECAST_MIN_HORIZON_DAYS, FORECAST_MAX_HORIZON_DAYS);

    const today = startOfUtcDay(new Date());
    const from = addUtcDays(today, -clampedLookback);

    const rows = await prisma.invoice.findMany({
      where: { organizationId, status: InvoiceStatus.PAID, createdAt: { gte: from, lt: today } },
      select: { createdAt: true, total: true },
    });

    const points = bucketDailyRevenue(
      rows.map((row) => ({ createdAt: row.createdAt, totalCents: toCents(row.total) })),
      from,
      today,
    );
    const result = buildSalesForecast(points, clampedHorizon, today);

    return {
      ...result,
      generatedAt: new Date().toISOString(),
      lookbackDays: clampedLookback,
      horizonDays: clampedHorizon,
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
}

function clamp(value: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toCents(value: { toFixed?: (digits?: number) => string } | number | null): number {
  if (value === null || value === undefined) return 0;
  const asString = typeof value === 'number' ? value.toFixed(2) : (value.toFixed?.(2) ?? '0.00');
  return Math.round(Number(asString) * 100);
}
