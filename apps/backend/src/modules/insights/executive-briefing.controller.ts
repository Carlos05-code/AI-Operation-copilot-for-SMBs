/**
 * Executive briefing endpoints (ROADMAP Phase 4 — executive insights
 * briefings). Reads are open to any member; the generation trigger requires
 * agent-or-above (mirrors `POST /tasks/plan`). Everything is org-scoped from
 * the verified token.
 */
import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { ExecutiveBriefingService } from './executive-briefing.service';

export class ListBriefingsQuery {
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

@ApiTags('insights')
@Controller('insights/briefings')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class ExecutiveBriefingController {
  constructor(private readonly briefings: ExecutiveBriefingService) {}

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org executive briefings, newest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListBriefingsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.briefings.list(organizationId, page, limit);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get('latest')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch the most recent briefing' })
  async latest(@CurrentUser() user: AuthContext) {
    return this.briefings.latest(this.requireOrganization(user));
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped briefing' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.briefings.get(this.requireOrganization(user), id);
  }

  @Post('generate')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Schedule a fresh AI executive briefing' })
  async generate(@CurrentUser() user: AuthContext) {
    const organizationId = this.requireOrganization(user);
    await this.briefings.requestGenerate(organizationId);
    return { briefingStatus: 'QUEUED' };
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
