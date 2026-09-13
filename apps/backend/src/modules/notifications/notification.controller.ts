/**
 * Notification delivery endpoint (ROADMAP Phase 3 — notifications). Reading
 * notifications is unread-count + latest-5, already surfaced by the
 * executive dashboard (API_SPEC §11.10); this covers the manual
 * delivery-sweep trigger, mirroring `/invoices/sweep-overdue` and
 * `/inventory/sweep-reorder-alerts`.
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
import { QUEUE_NOTIFICATIONS } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { JOB_NOTIFICATION_DELIVERY_SWEEP } from './notification.constants';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly queue: QueueService) {}

  @Post('sweep-delivery')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the notification-delivery sweep job' })
  async sweepDelivery(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    try {
      await this.queue.enqueue(QUEUE_NOTIFICATIONS, JOB_NOTIFICATION_DELIVERY_SWEEP, {});
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
