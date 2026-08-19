/**
 * Chat endpoint — grounded document Q&A with citations (API_SPEC §11.5,
 * AI_ARCHITECTURE §6–§10).
 *
 * Retrieves context over the requesting member's organization only (org id
 * comes from the verified token), grounds the answer against it, and returns
 * the structured answer contract with citations and confidence. Any
 * authenticated member may ask.
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
import { ChatService } from './chat.service';
import { CHAT_MAX_LIMIT, CHAT_QUERY_MAX_LENGTH } from './chat.constants';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHAT_QUERY_MAX_LENGTH)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHAT_MAX_LIMIT)
  limit?: number;
}

@ApiTags('chat')
@Controller('chat')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Grounded Q&A over the org knowledge base with citations' })
  async ask(@CurrentUser() user: AuthContext, @Body() dto: ChatDto) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    const answer = await this.chat.answer(organizationId, dto.query, dto.limit);
    return { query: dto.query, answer };
  }
}
