/**
 * Task endpoints (API_SPEC §11.11).
 *
 * Read/update surface over the org's tasks plus the AI planning trigger
 * (`POST /tasks/plan` schedules a `task.plan` job; the LLM converts business
 * signals into tasks with priorities and deadlines). Writes require
 * agent-or-above; reads are open to any member; everything is org-scoped.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { Role, TaskStatus } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { TaskService } from './task.service';

export class ListTasksQuery {
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
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;
}

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org tasks, priority then creation order' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListTasksQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.tasks.list(organizationId, page, limit, query.status);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped task' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.tasks.get(this.requireOrganization(user), id);
  }

  @Patch(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Update a task status (e.g. complete or cancel)' })
  async updateStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatus(this.requireOrganization(user), id, dto.status);
  }

  @Post('plan')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Schedule AI task planning from business signals' })
  async plan(@CurrentUser() user: AuthContext) {
    const organizationId = this.requireOrganization(user);
    await this.tasks.requestPlan(organizationId);
    return { planStatus: 'QUEUED' };
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
