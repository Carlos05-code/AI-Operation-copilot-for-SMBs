/**
 * Hybrid search endpoint — RAG retrieval entry point (API_SPEC §11.5,
 * AI_ARCHITECTURE §5).
 *
 * Fuses vector similarity (Qdrant) with keyword search (OpenSearch) over the
 * requesting member's organization only (org id comes from the verified token,
 * so results can never cross tenants). Any authenticated member may search.
 */
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { HybridSearchService } from './hybrid-search.service';
import { MAX_SEARCH_LIMIT } from './search.constants';

export class SearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_LIMIT)
  limit?: number;
}

@ApiTags('search')
@Controller('search')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class SearchController {
  constructor(private readonly hybrid: HybridSearchService) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Hybrid semantic + full-text search over the org knowledge base' })
  async search(@CurrentUser() user: AuthContext, @Body() dto: SearchDto) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    const results = await this.hybrid.search(organizationId, dto.query, dto.limit);
    return { query: dto.query, results };
  }
}
