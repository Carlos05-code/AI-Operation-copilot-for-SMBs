/**
 * Storage endpoints — presigned upload/download URLs (SECURITY_SPEC §10).
 *
 * Guard chain follows API_SPEC §6: `JwtAuthGuard` verifies the RS256 token,
 * `TenancyGuard` asserts the caller is a member of the org in the claims, and
 * `RolesGuard` enforces the route scopes. Uploads require an agent-or-above
 * scope; downloads are open to any authenticated member.
 */
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import {
  StorageService,
  type PresignUploadInput,
  type StorageDownloadReceipt,
  type StorageUploadReceipt,
} from './storage.service';

export class PresignUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contentType?: string;
}

export class PresignDownloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key!: string;
}

@ApiTags('storage')
@Controller('storage')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('uploads/presign')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Issue a presigned upload URL for a new object' })
  async presignUpload(
    @CurrentUser() user: AuthContext,
    @Body() dto: PresignUploadDto,
  ): Promise<StorageUploadReceipt> {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    const input: PresignUploadInput = {
      organizationId,
      filename: dto.filename,
      contentType: dto.contentType,
    };
    return this.storage.presignUpload(input);
  }

  @Get('objects')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Issue a presigned download URL for an object' })
  presignDownload(@Query() query: PresignDownloadDto): Promise<StorageDownloadReceipt> {
    return this.storage.presignDownload(query.key);
  }
}
