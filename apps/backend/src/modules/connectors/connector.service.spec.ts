/**
 * Unit tests — ConnectorService (channel adapters, customer resolution).
 */
import type { PrismaService } from '../database/prisma.service';
import type { ConversationService } from '../conversations/conversation.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { ConnectorService } from './connector.service';

function harness(
  overrides: {
    prisma?: {
      customer?: { findFirst: jest.Mock; create: jest.Mock };
    };
    conversations?: { create: jest.Mock };
  } = {},
): {
  service: ConnectorService;
  prisma: { customer: { findFirst: jest.Mock; create: jest.Mock } };
  conversations: { create: jest.Mock };
} {
  const customer = overrides.prisma?.customer ?? { findFirst: jest.fn(), create: jest.fn() };
  const conversations = overrides.conversations ?? { create: jest.fn() };
  const service = new ConnectorService(
    { customer } as unknown as PrismaService,
    conversations as unknown as ConversationService,
  );
  return { service, prisma: { customer }, conversations };
}

describe('ConnectorService', () => {
  it('ingests a WhatsApp message, normalizing the number and matching by whatsapp', async () => {
    const { service, prisma, conversations } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    conversations.create.mockResolvedValue({ conversation: { id: 'conv-1' }, messagesCreated: 1 });
    const result = await service.receive('org-1', 'whatsapp', {
      from: '+1 (555) 010-1234',
      text: 'Hi, I need a refund',
      messageId: 'wa-msg-1',
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', whatsapp: '+15550101234' },
      select: { id: true },
    });
    expect(conversations.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      channel: 'WHATSAPP',
      externalId: 'wa:+15550101234',
      customerId: 'cust-1',
      messages: [
        {
          sender: 'CUSTOMER',
          body: 'Hi, I need a refund',
          sentAt: expect.any(Date),
          externalId: 'wa-msg-1',
        },
      ],
    });
    expect(result.threadId).toBe('wa:+15550101234');
  });

  it('provisions a new WhatsApp customer when the number is unknown', async () => {
    const { service, prisma, conversations } = harness();
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.create.mockResolvedValue({ id: 'cust-new' });
    conversations.create.mockResolvedValue({ conversation: { id: 'conv-1' }, messagesCreated: 1 });
    await service.receive('org-1', 'whatsapp', { from: '1555010999', text: 'hello' });
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', name: '1555010999', whatsapp: '1555010999' },
      select: { id: true },
    });
    expect(conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-new' }),
    );
  });

  it('ingests an email, matching by lowercased address and keying threads by subject hash', async () => {
    const { service, prisma, conversations } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    conversations.create.mockResolvedValue({ conversation: { id: 'conv-1' }, messagesCreated: 1 });
    await service.receive('org-1', 'email', {
      fromAddress: 'JANE@Example.com',
      fromName: 'Jane Doe',
      subject: 'Invoice #102',
      body: 'Please re-send the invoice',
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', email: 'jane@example.com' },
      select: { id: true },
    });
    const createCall = conversations.create.mock.calls[0][0] as {
      externalId: string;
      title: string;
    };
    expect(createCall.externalId).toMatch(/^mail:[0-9a-f]{40}$/);
    expect(createCall.title).toBe('Invoice #102');
  });

  it('uses the email thread id when provided for idempotent thread upserts', async () => {
    const { service, prisma, conversations } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    conversations.create.mockResolvedValue({ conversation: { id: 'conv-1' }, messagesCreated: 1 });
    await service.receive('org-1', 'email', {
      fromAddress: 'jane@example.com',
      subject: 'Re: quote',
      body: 'thanks',
      threadId: 'thread-99',
      messageId: 'msg-1',
    });
    const createCall = conversations.create.mock.calls[0][0] as { externalId: string };
    expect(createCall.externalId).toBe('mail:thread-99');
  });

  it('ingests a Slack message, threading replies via threadTs', async () => {
    const { service, prisma, conversations } = harness();
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.create.mockResolvedValue({ id: 'cust-new' });
    conversations.create.mockResolvedValue({ conversation: { id: 'conv-1' }, messagesCreated: 1 });
    await service.receive('org-1', 'slack', {
      user: 'U123',
      userEmail: 'jane@example.com',
      text: 'Is my order ready?',
      channel: 'C456',
      threadTs: '1724.000001',
    });
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', name: 'U123', email: 'jane@example.com' },
      select: { id: true },
    });
    const createCall = conversations.create.mock.calls[0][0] as { externalId: string };
    expect(createCall.externalId).toBe('slack:1724.000001');
  });

  it('rejects an unsupported channel with 400', async () => {
    const { service } = harness();
    await expect(service.receive('org-1', 'telegram', { text: 'x' })).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
    });
  });

  it('rejects missing required per-channel fields with 400', async () => {
    const { service } = harness();
    await expect(service.receive('org-1', 'whatsapp', { text: 'no from' })).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
    });
    await expect(
      service.receive('org-1', 'email', { fromAddress: 'a@b.co' }),
    ).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
    });
    await expect(service.receive('org-1', 'slack', { user: 'U1' })).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
    });
  });

  it('rejects invalid timestamps with 400', async () => {
    const { service } = harness();
    await expect(
      service.receive('org-1', 'whatsapp', { from: '1', text: 'hi', timestamp: 'not-a-date' }),
    ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR, status: 400 });
  });

  it('fails with a contract error when the database is not configured', async () => {
    const service = new ConnectorService(undefined, undefined);
    await expect(
      service.receive('org-1', 'whatsapp', { from: '1', text: 'hi' }),
    ).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
