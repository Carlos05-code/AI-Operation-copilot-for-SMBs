/**
 * ConnectorService: channel adapters (ROADMAP Phase 2, API_SPEC §11.9).
 *
 * `POST /api/v1/connectors/:channel/inbound` receives channel-native payloads
 * (WhatsApp-style, email-style, Slack-style) and translates them into the
 * canonical conversation ingestion pipeline:
 *
 *   1. resolve the customer by channel identity — WhatsApp by normalized
 *      number (`Customer.whatsapp`), email by address (`Customer.email`,
 *      case-insensitive), Slack by profile email, falling back to a provisioned
 *      customer when unknown;
 *   2. derive a deterministic thread external id (`wa:`, `mail:`, `slack:`)
 *      so re-delivered webhooks upsert instead of duplicating;
 *   3. call `ConversationService.create` with the mapped channel/messages.
 *
 * All inbound messages are `CUSTOMER`-sender. Every write is org-scoped from
 * the token; payloads are validated per channel and rejected with 400 when
 * required fields are missing or timestamps are invalid.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConversationChannel, MessageSender } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { ConversationService } from '../conversations/conversation.service';
import type { ConnectorChannel } from './connector.constants';
import { CONNECTOR_CHANNELS } from './connector.constants';

export interface InboundMessage {
  /** WhatsApp: phone number of the sender (digits, optional leading +). */
  from?: string;
  /** WhatsApp: the message text. */
  text?: string;
  /** Email: sender address. */
  fromAddress?: string;
  /** Email: display name of the sender. */
  fromName?: string;
  /** Email: subject line. */
  subject?: string;
  /** Email: body text. */
  body?: string;
  /** Slack: user id or name. */
  user?: string;
  /** Slack: profile email (used to resolve the customer). */
  userEmail?: string;
  /** Slack: channel id the message was posted to. */
  channel?: string;
  /** Slack: parent message ts when this is a reply in a thread. */
  threadTs?: string;
  /** ISO-8601 send timestamp; defaults to now when absent. */
  timestamp?: string;
  /** Provider message id (dedupe key for message upserts). */
  messageId?: string;
  /** Email thread id (dedupe key for thread upserts). */
  threadId?: string;
}

export interface ConnectorResult {
  conversationId: string;
  customerId: string;
  messagesCreated: number;
  threadId: string;
}

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly conversations?: ConversationService,
  ) {}

  async receive(
    organizationId: string,
    channel: string,
    message: InboundMessage,
  ): Promise<ConnectorResult> {
    if (!CONNECTOR_CHANNELS.includes(channel as ConnectorChannel)) {
      throw new ApiError({
        code: HttpErrorCode.VALIDATION_ERROR,
        status: 400,
        message: `Unsupported channel '${channel}'; expected one of: ${CONNECTOR_CHANNELS.join(', ')}`,
      });
    }
    if (!this.prisma || !this.conversations) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }

    switch (channel as ConnectorChannel) {
      case 'whatsapp':
        return this.receiveWhatsApp(organizationId, message);
      case 'email':
        return this.receiveEmail(organizationId, message);
      case 'slack':
        return this.receiveSlack(organizationId, message);
    }
  }

  private async receiveWhatsApp(
    organizationId: string,
    message: InboundMessage,
  ): Promise<ConnectorResult> {
    const from = requireField(message.from, 'from', 'WhatsApp');
    const text = requireField(message.text, 'text', 'WhatsApp');
    const normalized = normalizeWhatsApp(from);
    const sentAt = parseTimestamp(message.timestamp);
    const customer = await this.resolveCustomer(organizationId, {
      where: { organizationId, whatsapp: normalized },
      provision: { name: from, whatsapp: normalized },
    });
    const threadId = `wa:${normalized}`;
    const result = await this.conversations!.create({
      organizationId,
      channel: ConversationChannel.WHATSAPP,
      externalId: threadId,
      customerId: customer.id,
      messages: [
        {
          sender: MessageSender.CUSTOMER,
          body: text,
          sentAt,
          externalId: message.messageId,
        },
      ],
    });
    return {
      conversationId: result.conversation.id,
      customerId: customer.id,
      messagesCreated: result.messagesCreated,
      threadId,
    };
  }

  private async receiveEmail(
    organizationId: string,
    message: InboundMessage,
  ): Promise<ConnectorResult> {
    const fromAddress = requireField(message.fromAddress, 'fromAddress', 'Email');
    const subject = requireField(message.subject, 'subject', 'Email');
    const body = requireField(message.body, 'body', 'Email');
    const normalizedAddress = fromAddress.trim().toLowerCase();
    const sentAt = parseTimestamp(message.timestamp);
    const customer = await this.resolveCustomer(organizationId, {
      where: { organizationId, email: normalizedAddress },
      provision: { name: message.fromName?.trim() || fromAddress, email: normalizedAddress },
    });
    const threadId = `mail:${message.threadId?.trim() || message.messageId?.trim() || sha1(subject)}`;
    const result = await this.conversations!.create({
      organizationId,
      channel: ConversationChannel.EMAIL,
      externalId: threadId,
      customerId: customer.id,
      title: subject,
      messages: [
        {
          sender: MessageSender.CUSTOMER,
          body,
          sentAt,
          externalId: message.messageId,
        },
      ],
    });
    return {
      conversationId: result.conversation.id,
      customerId: customer.id,
      messagesCreated: result.messagesCreated,
      threadId,
    };
  }

  private async receiveSlack(
    organizationId: string,
    message: InboundMessage,
  ): Promise<ConnectorResult> {
    const user = requireField(message.user, 'user', 'Slack');
    const text = requireField(message.text, 'text', 'Slack');
    const channel = requireField(message.channel, 'channel', 'Slack');
    const sentAt = parseTimestamp(message.timestamp);
    const customer = await this.resolveCustomer(organizationId, {
      where: message.userEmail
        ? { organizationId, email: message.userEmail.trim().toLowerCase() }
        : undefined,
      provision: {
        name: user,
        ...(message.userEmail ? { email: message.userEmail.trim().toLowerCase() } : {}),
      },
    });
    const threadId = `slack:${(message.threadTs || `${channel}:${user}`).trim()}`;
    const result = await this.conversations!.create({
      organizationId,
      channel: ConversationChannel.SLACK,
      externalId: threadId,
      customerId: customer.id,
      messages: [
        {
          sender: MessageSender.CUSTOMER,
          body: text,
          sentAt,
          externalId: message.messageId,
        },
      ],
    });
    return {
      conversationId: result.conversation.id,
      customerId: customer.id,
      messagesCreated: result.messagesCreated,
      threadId,
    };
  }

  /**
   * Matches an existing org customer by channel identity or provisions a new
   * one (channel identity columns on `customers` are the pointer).
   */
  private async resolveCustomer(
    organizationId: string,
    opts: {
      where?: { organizationId: string; email?: string; whatsapp?: string };
      provision: { name: string; email?: string; whatsapp?: string };
    },
  ): Promise<{ id: string }> {
    const existing = opts.where
      ? await this.prisma!.customer.findFirst({ where: opts.where, select: { id: true } })
      : null;
    if (existing) return existing;
    return this.prisma!.customer.create({
      data: {
        organizationId,
        name: opts.provision.name,
        email: opts.provision.email,
        whatsapp: opts.provision.whatsapp,
      },
      select: { id: true },
    });
  }
}

function requireField(value: string | undefined, field: string, channel: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `${channel} inbound message is missing required field '${field}'`,
    });
  }
  return value.trim();
}

function parseTimestamp(timestamp: string | undefined): Date {
  if (timestamp === undefined || timestamp.length === 0) return new Date();
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `Invalid 'timestamp' (expected ISO-8601): ${timestamp}`,
    });
  }
  return parsed;
}

/** WhatsApp numbers: keep digits and a single leading `+` (E.164-ish). */
function normalizeWhatsApp(number: string): string {
  const digits = number.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? `+${digits.slice(1)}` : digits;
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
