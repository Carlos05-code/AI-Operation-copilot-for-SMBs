/**
 * Conversation ingestion endpoints (API_SPEC §11.6, DATABASE_SPEC §3).
 *
 * Accepts a conversation with its messages (WhatsApp / email / Slack
 * connectors will feed this endpoint or the underlying service). Writes
 * require agent-or-above scope; responses are org-scoped from the token.
 */
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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
}
