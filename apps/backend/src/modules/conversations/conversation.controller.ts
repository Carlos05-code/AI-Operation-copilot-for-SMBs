/**
 * Conversation endpoints (API_SPEC §11.6, §11.8, DATABASE_SPEC §3).
 *
 * Ingestion accepts a conversation with its messages (WhatsApp / email /
 * Slack connectors will feed this endpoint or the underlying service).
 * Writes require agent-or-above scope; reads are org-scoped from the token.
 * `POST /:id/summarize` schedules a `conversation.summarize` job on the
 * `summary-jobs` queue; the resulting summary lands on the row and is
 * readable via `GET /:id`.
 */
import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { ConversationChannel, MessageSender, Role } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { CurrentUser, RequireRoles } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { TenancyGuard } from '../auth/tenancy.guard';
import type { AuthContext } from '../auth/auth.types';
import {
  CONVERSATION_EXTERNAL_ID_MAX_LENGTH,
  CONVERSATION_MAX_MESSAGES,
  CONVERSATION_TITLE_MAX_LENGTH,
  MESSAGE_BODY_MAX_LENGTH,
} from './conversation.constants';
import { ConversationService } from './conversation.service';

export class ConversationMessageDto {
  @IsEnum(MessageSender)
  sender!: MessageSender;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_BODY_MAX_LENGTH)
  body!: string;

  @IsDateString()
  sentAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONVERSATION_EXTERNAL_ID_MAX_LENGTH)
  externalId?: string;
}

export class CreateConversationDto {
  @IsEnum(ConversationChannel)
  channel!: ConversationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(CONVERSATION_EXTERNAL_ID_MAX_LENGTH)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONVERSATION_TITLE_MAX_LENGTH)
  title?: string;

  @IsArray()
  @ArrayMaxSize(CONVERSATION_MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  messages!: ConversationMessageDto[];
}

export class ListConversationsQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Ingest a customer conversation with its messages' })
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateConversationDto) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    const { conversation, messagesCreated } = await this.conversations.create({
      organizationId,
      channel: dto.channel,
      externalId: dto.externalId,
      customerId: dto.customerId,
      title: dto.title,
      messages: dto.messages.map((message) => ({
        sender: message.sender,
        body: message.body,
        sentAt: new Date(message.sentAt),
        externalId: message.externalId,
      })),
    });
    return { conversation, messagesCreated };
  }

  @Get()
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'List the org conversations, newest updated first' })
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListConversationsQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.conversations.list(organizationId, page, limit);
    res.setHeader('X-Total-Count', String(total));
    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  @ApiOperation({ summary: 'Fetch one org-scoped conversation with messages and summary' })
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    return this.conversations.get(organizationId, id);
  }

  @Post(':id/summarize')
  @RequireRoles(Role.OWNER, Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Schedule an AI summary of an org conversation' })
  async summarize(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const organizationId = user?.organizationId;
    if (!organizationId) {
      throw new ApiError({
        code: HttpErrorCode.FORBIDDEN,
        status: 403,
        message: 'Token carries no organization claim',
      });
    }
    await this.conversations.requestSummary(organizationId, id);
    return { conversationId: id, summaryStatus: 'QUEUED' };
  }
}
