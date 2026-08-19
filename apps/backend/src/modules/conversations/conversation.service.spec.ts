/**
 * Unit tests — ConversationService (persist, idempotency, events, jobs).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import type { QueueService } from '../queue/queue.service';
import { ConversationService } from './conversation.service';

function harness(
  overrides: {
    prisma?: {
      customer?: { findFirst: jest.Mock };
      conversation?: {
        upsert: jest.Mock;
        create: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
      };
      message?: { createMany: jest.Mock };
    };
    outbox?: { append: jest.Mock };
    queue?: { enqueue: jest.Mock };
  } = {},
): {
  service: ConversationService;
  prisma: {
    customer: { findFirst: jest.Mock };
    conversation: {
      upsert: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    message: { createMany: jest.Mock };
  };
  outbox: { append: jest.Mock };
  queue: { enqueue: jest.Mock };
} {
  const customer = overrides.prisma?.customer ?? { findFirst: jest.fn() };
  const conversation = overrides.prisma?.conversation ?? {
    upsert: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const message = overrides.prisma?.message ?? { createMany: jest.fn() };
  const prisma = { customer, conversation, message } as unknown as PrismaService;
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const queue = overrides.queue ?? { enqueue: jest.fn() };
  const service = new ConversationService(
    prisma,
    outbox as unknown as OutboxService,
    queue as unknown as QueueService,
  );
  return { service, prisma: { customer, conversation, message }, outbox, queue };
}

const input = {
  organizationId: 'org-1',
  channel: 'WHATSAPP' as const,
  externalId: 'wa-1',
  customerId: 'cust-1',
  messages: [
    { sender: 'CUSTOMER' as const, body: 'Hello', sentAt: new Date('2026-08-19T09:00:00Z') },
  ],
};

describe('ConversationService', () => {
  it('persists a new conversation with its messages and fires events + jobs', async () => {
    const { service, prisma, outbox, queue } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1', organizationId: 'org-1' });
    prisma.message.createMany.mockResolvedValue({ count: 1 });
    const result = await service.create(input);
    expect(result.conversation.id).toBe('conv-1');
    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_externalId: { organizationId: 'org-1', externalId: 'wa-1' } },
      }),
    );
    expect(prisma.message.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          {
            conversationId: 'conv-1',
            sender: 'CUSTOMER',
            body: 'Hello',
            sentAt: input.messages[0]?.sentAt,
            externalId: undefined,
          },
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'conversation',
        aggregateId: 'conv-1',
        eventType: 'conversation.ingested',
        payload: expect.objectContaining({ messageCount: 1 }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('ai-jobs', 'conversation.embed', {
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });
    expect(result.messagesCreated).toBe(1);
  });

  it('creates a fresh conversation when no external id is given', async () => {
    const { service, prisma } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.conversation.create.mockResolvedValue({ id: 'conv-9', organizationId: 'org-1' });
    prisma.message.createMany.mockResolvedValue({ count: 0 });
    await service.create({ ...input, externalId: undefined });
    expect(prisma.conversation.create).toHaveBeenCalled();
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it('returns 404 when the customer is not in the organization', async () => {
    const { service, prisma } = harness();
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.create(input)).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it('swallows outbox and enqueue failures without failing the write', async () => {
    const { service, prisma, outbox, queue } = harness();
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1', organizationId: 'org-1' });
    prisma.message.createMany.mockResolvedValue({ count: 1 });
    outbox.append.mockRejectedValue(new Error('db down'));
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    const result = await service.create(input);
    expect(result.messagesCreated).toBe(1);
  });

  it('fails with a contract error when the database is not configured', async () => {
    const service = new ConversationService(undefined, undefined, undefined);
    await expect(service.create(input)).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });

  it('schedules a summary job for an org conversation', async () => {
    const { service, prisma, queue } = harness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    await service.requestSummary('org-1', 'conv-1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', organizationId: 'org-1' } }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('summary-jobs', 'conversation.summarize', {
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });
  });

  it('returns 404 when scheduling a summary for a foreign conversation', async () => {
    const { service, prisma, queue } = harness();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.requestSummary('org-2', 'conv-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('swallows enqueue failures when scheduling a summary', async () => {
    const { service, prisma, queue } = harness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.requestSummary('org-1', 'conv-1')).resolves.toBeUndefined();
  });

  it('lists the org conversations with counts, newest updated first', async () => {
    const { service, prisma } = harness();
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        channel: 'WHATSAPP',
        title: null,
        externalId: null,
        customerId: null,
        summary: 'Customer asked about pricing.',
        summaryGeneratedAt: new Date('2026-08-19T10:00:00Z'),
        updatedAt: new Date('2026-08-19T11:00:00Z'),
        _count: { messages: 7 },
        messages: [{ sentAt: new Date('2026-08-19T10:30:00Z') }],
      },
    ]);
    prisma.conversation.count.mockResolvedValue(1);
    const result = await service.list('org-1', 1, 20);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' }, skip: 0, take: 20 }),
    );
    expect(result.items[0]).toMatchObject({
      id: 'conv-1',
      messageCount: 7,
      lastMessageAt: new Date('2026-08-19T10:30:00Z'),
      summary: 'Customer asked about pricing.',
    });
    expect(result.total).toBe(1);
  });

  it('fetches an org conversation with its messages', async () => {
    const { service, prisma } = harness();
    const message = { id: 'm1', sender: 'CUSTOMER', body: 'Hello', sentAt: new Date() };
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      messages: [message],
    });
    const result = await service.get('org-1', 'conv-1');
    expect(result.messages[0]).toMatchObject({ sender: 'CUSTOMER', body: 'Hello' });
  });

  it('returns 404 for a foreign conversation on get', async () => {
    const { service, prisma } = harness();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'conv-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });
});
