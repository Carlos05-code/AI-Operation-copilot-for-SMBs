/**
 * Invoice endpoints (ROADMAP Phase 3, API_SPEC §11.1).
 *
 * `POST /invoices` generates an invoice from priced line items;
 * `POST /invoices/:id/{issue,pay,void}` drive the lifecycle state machine;
 * `POST /invoices/sweep-overdue` schedules the `invoice.overdue.sweep` job.
 * Writes require agent-or-above (void requires manager-or-above); reads are
 * open to any member; everything is org-scoped from the verified token.
 */
import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
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
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { InvoiceStatus, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { QueueService } from '../queue/queue.service';
import { QUEUE_OPS_JOBS } from '../queue/queue.constants';
import {
  INVOICE_DESCRIPTION_MAX_LENGTH,
  INVOICE_MAX_LINE_ITEMS,
  INVOICE_MAX_TAX_RATE,
  INVOICE_NOTE_MAX_LENGTH,
  JOB_INVOICE_OVERDUE_SWEEP,
} from './invoice.constants';
import { InvoiceService } from './invoice.service';

export class InvoiceLineItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(INVOICE_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  unitPrice!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(INVOICE_MAX_TAX_RATE)
  taxRate?: number;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVOICE_MAX_LINE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  items!: InvoiceLineItemDto[];

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_NOTE_MAX_LENGTH)
  note?: string;

  @IsOptional()
  @IsBoolean()
  issue?: boolean;
}

export class ListInvoicesQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}

@ApiTags('invoices')
@Controller('invoices')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly queue: QueueService,
  ) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Generate an invoice from priced line items' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateInvoiceDto) {
    const dueDate = parseDate(dto.dueDate, 'dueDate');
    return this.invoices.create({
      organizationId: this.requireOrganization(user),
      customerId: dto.customerId,
      items: dto.items,
      dueDate,
      note: dto.note ?? null,
      issue: dto.issue ?? false,
    });
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org invoices, newest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListInvoicesQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.invoices.list(organizationId, page, limit, query.status);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped invoice with its line items' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.invoices.get(this.requireOrganization(user), id);
  }

  @Post(':id/issue')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Issue a draft invoice (DRAFT → SENT)' })
  async issue(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.invoices.issue(this.requireOrganization(user), id);
  }

  @Post(':id/pay')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Mark an invoice paid (SENT | OVERDUE → PAID)' })
  async pay(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.invoices.markPaid(this.requireOrganization(user), id);
  }

  @Post(':id/void')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Void an invoice (DRAFT | SENT | OVERDUE → VOID)' })
  async void(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.invoices.voidInvoice(this.requireOrganization(user), id);
  }

  @Post('sweep-overdue')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the overdue-invoice sweep job' })
  async sweepOverdue(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    try {
      await this.queue.enqueue(QUEUE_OPS_JOBS, JOB_INVOICE_OVERDUE_SWEEP, {});
    } catch {
      // Redis down must not fail the request; the sweep can be re-scheduled.
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
