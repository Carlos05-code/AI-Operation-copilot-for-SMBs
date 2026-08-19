/**
 * Knowledge-base endpoints (API_SPEC §11.7, §4 pagination).
 *
 * Read-only surface over the org knowledge registry (INDEXED documents).
 * Any authenticated member may browse; every query is scoped to the org from
 * the verified token, and cross-org entries surface as 404.
 */
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { KNOWLEDGE_DEFAULT_LIMIT, KNOWLEDGE_MAX_LIMIT } from './knowledge.constants';
import { KnowledgeService } from './knowledge.service';

export class ListKnowledgeQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(KNOWLEDGE_MAX_LIMIT)
  limit?: number;
}

@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org knowledge base, newest first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListKnowledgeQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? KNOWLEDGE_DEFAULT_LIMIT;
    const result = await this.knowledge.list(organizationId, page, limit);
    res.setHeader('X-Total-Count', String(result.total));
    return {
      items: result.items,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages,
      },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one knowledge entry (org-scoped)' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const organizationId = this.requireOrganization(user);
    return this.knowledge.get(organizationId, id);
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
