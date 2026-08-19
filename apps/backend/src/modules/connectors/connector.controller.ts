/**
 * Channel connector inbound endpoint (API_SPEC §11.9).
 *
 * `POST /api/v1/connectors/:channel/inbound` receives channel-native payloads
 * and funnels them into the conversation pipeline. Authenticated (agent-or-
 * above — connector service accounts / relay agents); every write is scoped
 * to the org from the token. Body fields are validated per channel by the
 * connector service (missing required fields or bad timestamps → 400).
 */
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import {
  CONNECTOR_FROM_MAX_LENGTH,
  CONNECTOR_SUBJECT_MAX_LENGTH,
  CONNECTOR_THREAD_MAX_LENGTH,
  CONNECTOR_USER_MAX_LENGTH,
} from './connector.constants';
import { ConnectorService } from './connector.service';

export class InboundMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_FROM_MAX_LENGTH)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_FROM_MAX_LENGTH)
  fromAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_FROM_MAX_LENGTH)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_SUBJECT_MAX_LENGTH)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_USER_MAX_LENGTH)
  user?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_FROM_MAX_LENGTH)
  userEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_THREAD_MAX_LENGTH)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_THREAD_MAX_LENGTH)
  threadTs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_THREAD_MAX_LENGTH)
  threadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONNECTOR_THREAD_MAX_LENGTH)
  messageId?: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

@ApiTags('connectors')
@Controller('connectors')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class ConnectorController {
  constructor(private readonly connectors: ConnectorService) {}

  @Post(':channel/inbound')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Ingest a channel-native message (WhatsApp / email / Slack)' })
  async inbound(
    @CurrentUser() user: AuthContext,
    @Param('channel') channel: string,
    @Body() message: InboundMessageDto,
  ) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    return this.connectors.receive(organizationId, channel, message);
  }
}
