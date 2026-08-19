/**
 * DashboardModule: executive dashboard (ROADMAP Phase 3, API_SPEC §11.10).
 *
 * Read-only org-scoped KPI snapshot over invoices, tasks, and notifications.
 * Fails with a contract error when the database is not configured; never
 * blocks boot.
 */
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
