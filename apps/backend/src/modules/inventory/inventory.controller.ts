/**
 * Inventory-wide endpoints (ROADMAP Phase 3 — inventory tracking with
 * reorder alerts). Product- and movement-scoped endpoints live on
 * `ProductController`; this covers the manual reorder-sweep trigger,
 * mirroring `POST /invoices/sweep-overdue`.
 */
import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { JOB_INVENTORY_REORDER_SWEEP } from './inventory.constants';

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly queue: QueueService) {}

  @Post('sweep-reorder-alerts')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the reorder-alert sweep job' })
  async sweepReorderAlerts(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    try {
      await this.queue.enqueue(QUEUE_OPS_JOBS, JOB_INVENTORY_REORDER_SWEEP, {});
    } catch {
      return { sweepStatus: 'SKIPPED' };
    }
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
