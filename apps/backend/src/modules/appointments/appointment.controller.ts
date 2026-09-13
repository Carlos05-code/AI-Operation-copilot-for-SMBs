/**
 * Appointment endpoints (ROADMAP Phase 3 — appointment scheduling).
 * Writes require agent-or-above; the manual reminder-sweep trigger
 * requires manager-or-above (mirrors `/invoices/sweep-overdue`); reads are
 * open to any member. Everything is org-scoped from the verified token.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { AppointmentStatus, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import {
  APPOINTMENT_NOTES_MAX_LENGTH,
  APPOINTMENT_TITLE_MAX_LENGTH,
  JOB_APPOINTMENT_REMINDER_SWEEP,
} from './appointment.constants';
import { AppointmentService } from './appointment.service';

export class CreateAppointmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assigneeId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(APPOINTMENT_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(APPOINTMENT_NOTES_MAX_LENGTH)
  notes?: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(APPOINTMENT_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(APPOINTMENT_NOTES_MAX_LENGTH)
  notes?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class ListAppointmentsQuery {
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
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assigneeId?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}

@ApiTags('appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class AppointmentController {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly queue: QueueService,
  ) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Book an appointment' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateAppointmentDto) {
    return this.appointments.create({
      organizationId: this.requireOrganization(user),
      customerId: dto.customerId,
      assigneeId: dto.assigneeId,
      title: dto.title,
      notes: dto.notes,
      startAt: parseDate(dto.startAt, 'startAt'),
      endAt: parseDate(dto.endAt, 'endAt'),
    });
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org appointments, soonest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListAppointmentsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.appointments.list(organizationId, page, limit, {
      from: query.from ? parseDate(query.from, 'from') : undefined,
      to: query.to ? parseDate(query.to, 'to') : undefined,
      assigneeId: query.assigneeId,
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
  @ApiOperation({ summary: 'Fetch one org-scoped appointment' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.appointments.get(this.requireOrganization(user), id);
  }

  @Patch(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Edit an appointment; reschedules re-check for conflicts' })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointments.update(this.requireOrganization(user), id, {
      title: dto.title,
      notes: dto.notes,
      startAt: dto.startAt ? parseDate(dto.startAt, 'startAt') : undefined,
      endAt: dto.endAt ? parseDate(dto.endAt, 'endAt') : undefined,
    });
  }

  @Post(':id/confirm')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Confirm a scheduled appointment' })
  async confirm(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.appointments.updateStatus(
      this.requireOrganization(user),
      id,
      AppointmentStatus.CONFIRMED,
    );
  }

  @Post(':id/cancel')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Cancel an appointment' })
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.appointments.updateStatus(
      this.requireOrganization(user),
      id,
      AppointmentStatus.CANCELLED,
    );
  }

  @Post(':id/complete')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Mark an appointment completed' })
  async complete(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.appointments.updateStatus(
      this.requireOrganization(user),
      id,
      AppointmentStatus.COMPLETED,
    );
  }

  @Post(':id/no-show')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Mark the customer a no-show' })
  async noShow(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.appointments.updateStatus(
      this.requireOrganization(user),
      id,
      AppointmentStatus.NO_SHOW,
    );
  }

  @Post('sweep-reminders')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the appointment-reminder sweep job' })
  async sweepReminders(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    try {
      await this.queue.enqueue(QUEUE_OPS_JOBS, JOB_APPOINTMENT_REMINDER_SWEEP, {});
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

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `Invalid '${field}' (expected ISO-8601): ${value}`,
    });
  }
  return parsed;
}
