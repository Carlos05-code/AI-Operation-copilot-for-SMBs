/**
 * ForecastingModule: sales forecasting (ROADMAP Phase 4, PROJECT_SPEC §7.7).
 *
 * Read-only `GET /forecasting/sales` over `PAID` invoice history — a linear
 * trend plus day-of-week seasonality, no LLM. Fails with a contract error
 * when the database is not configured; never blocks boot.
 */
import { Module } from '@nestjs/common';
import { SalesForecastController } from './sales-forecast.controller';
import { SalesForecastService } from './sales-forecast.service';

@Module({
  controllers: [SalesForecastController],
  providers: [SalesForecastService],
  exports: [SalesForecastService],
})
export class ForecastingModule {}
