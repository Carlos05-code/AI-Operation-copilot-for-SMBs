/**
 * Workflow rule endpoints (ROADMAP Phase 4 — visual workflow builder /
 * rules engine, stretch). Reads are open to any member; writes and the
 * manual sweep trigger require agent-or-above/manager-or-above
 * respectively (the sweep mirrors `/invoices/sweep-overdue`). Everything
 * is org-scoped from the verified token.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { WorkflowRuleService } from './workflow-rule.service';
import { WORKFLOW_RULE_NAME_MAX_LENGTH, WORKFLOW_TRIGGER_ENTITIES } from './workflow.constants';

export class CreateWorkflowRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKFLOW_RULE_NAME_MAX_LENGTH)
  name!: string;

  @IsIn(WORKFLOW_TRIGGER_ENTITIES)
  triggerEntity!: string;

  @IsArray()
  conditions!: unknown[];

  @IsArray()
  actions!: unknown[];
}

export class UpdateWorkflowRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKFLOW_RULE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsArray()
  conditions?: unknown[];

  @IsOptional()
  @IsArray()
  actions?: unknown[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListWorkflowRulesQuery {
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
  @IsIn(['true', 'false'])
  active?: string;
}

export class ListRunsQuery {
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
}

@ApiTags('workflows')
@Controller('workflows/rules')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class WorkflowRuleController {
  constructor(private readonly rules: WorkflowRuleService) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Create a workflow rule (when <conditions>, do <actions>)' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateWorkflowRuleDto) {
    return this.rules.create({
      organizationId: this.requireOrganization(user),
      name: dto.name,
      triggerEntity: dto.triggerEntity,
      conditions: dto.conditions,
      actions: dto.actions,
    });
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org workflow rules, newest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListWorkflowRulesQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const active = query.active === undefined ? undefined : query.active === 'true';
    const { items, total } = await this.rules.list(organizationId, page, limit, active);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped workflow rule' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.rules.get(this.requireOrganization(user), id);
  }

  @Patch(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Update a rule (name/conditions/actions/active)' })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowRuleDto,
  ) {
    return this.rules.update(this.requireOrganization(user), id, dto);
  }

  @Get(':id/runs')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: "List a rule's fire history, newest first" })
  async listRuns(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query() query: ListRunsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.rules.listRuns(organizationId, id, page, limit);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Post('sweep')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Schedule the workflow rules sweep job' })
  async sweep(@CurrentUser() user: AuthContext) {
    this.requireOrganization(user);
    await this.rules.requestSweep();
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
