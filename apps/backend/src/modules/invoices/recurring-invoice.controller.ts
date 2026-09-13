/**
 * Recurring-invoice (billing schedule) endpoints (ROADMAP Phase 3).
 *
 * `POST /recurring-invoices` stores a validated invoice template + cadence;
 * `POST /recurring-invoices/:id/{pause,resume}` toggle it; `POST
 * /recurring-invoices/run` schedules the `invoice.recurrence.run` job.
 * Writes require manager-or-above; reads are open to any member; everything is
 * org-scoped from the verified token.
 */
import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { RecurrenceCadence, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { QueueService } from '../queue/queue.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import { InvoiceLineItemDto } from './invoice.controller';
import {
  INVOICE_MAX_LINE_ITEMS,
  INVOICE_NOTE_MAX_LENGTH,
  JOB_INVOICE_RECURRENCE_RUN,
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_MAX_NET_TERMS_DAYS,
} from './invoice.constants';
import { RecurringInvoiceService } from './recurring-invoice.service';

export class CreateRecurringInvoiceDto {
  @IsString()
  @MaxLength(255)
  customerId!: string;

  @IsEnum(RecurrenceCadence)
  cadence!: RecurrenceCadence;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RECURRENCE_MAX_INTERVAL)
  interval?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RECURRENCE_MAX_NET_TERMS_DAYS)
  netTermsDays?: number;

  @IsOptional()
  @IsBoolean()
  issueOnCreate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_NOTE_MAX_LENGTH)
  note?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVOICE_MAX_LINE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  items!: InvoiceLineItemDto[];
}

export class ListRecurringInvoicesQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('recurring-invoices')
@Controller('recurring-invoices')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class RecurringInvoiceController {
  constructor(
    private readonly schedules: RecurringInvoiceService,
    private readonly queue: QueueService,
  ) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a recurring-invoice billing schedule' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateRecurringInvoiceDto) {
    return this.schedules.create({
      organizationId: this.requireOrganization(user),
      customerId: dto.customerId,
      items: dto.items,
      cadence: dto.cadence,
      interval: dto.interval,
      netTermsDays: dto.netTermsDays,
      issueOnCreate: dto.issueOnCreate,
      note: dto.note ?? null,
      startsAt: dto.startsAt ? parseDate(dto.startsAt, 'startsAt') : undefined,
    });
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org billing schedules, newest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRecurringInvoicesQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.schedules.list(organizationId, page, limit);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped billing schedule' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.schedules.get(this.requireOrganization(user), id);
  }

  @Post(':id/pause')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Pause a billing schedule' })
  async pause(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.schedules.setActive(this.requireOrganization(user), id, false);
  }

  @Post(':id/resume')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Resume a paused billing schedule' })
  async resume(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.schedules.setActive(this.requireOrganization(user), id, true);
  }

  @Delete(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Delete a billing schedule (issued invoices are kept)' })
  async remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.schedules.remove(this.requireOrganization(user), id);
    return { deleted: true };
  }

  @Post('run')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the recurring-invoice generation job' })
  async run(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    try {
      await this.queue.enqueue(QUEUE_OPS_JOBS, JOB_INVOICE_RECURRENCE_RUN, {});
    } catch {
      return { runStatus: 'SKIPPED' };
    }
    return { runStatus: 'QUEUED' };
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
