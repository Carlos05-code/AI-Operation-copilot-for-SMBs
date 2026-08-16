/**
 * Document endpoints — ingestion pipeline (ROADMAP Phase 2, SECURITY_SPEC §10).
 *
 * Upload flow: presign an upload (`POST /api/v1/storage/uploads/presign`),
 * PUT the file directly to MinIO, then register the object here
 * (`POST /api/v1/documents`) and trigger ingestion
 * (`POST /api/v1/documents/:id/ingest`).
 *
 * Guard chain per API_SPEC §6; writes require agent-or-above scope, reads are
 * open to any authenticated member.
 */
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Document } from '@prisma/client';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import { IngestionService, type CreateDocumentInput } from './ingestion.service';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contentType!: string;

  @IsInt()
  @Min(0)
  @Max(1073741824)
  sizeBytes!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  storageKey!: string;
}

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Register an uploaded object as a document' })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateDocumentDto,
  ): Promise<Document> {
    const input: CreateDocumentInput = {
      organizationId: this.requireOrganization(user),
      fileName: dto.fileName,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      storageKey: dto.storageKey,
    };
    return this.ingestion.create(input);
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch a document and its ingestion status' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<Document> {
    return this.ingestion.get(this.requireOrganization(user), id);
  }

  @Post(':id/ingest')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Run the ingestion pipeline for a document' })
  async ingest(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<Document> {
    return this.ingestion.ingest(this.requireOrganization(user), id);
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
