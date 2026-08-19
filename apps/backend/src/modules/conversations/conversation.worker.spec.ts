/**
 * Unit tests — ConversationWorker (message embedding into conversation_{org}).
 */
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { PrismaService } from '../database/prisma.service';
import type { EmbeddingProvider } from '../embeddings/embedding.provider';
import type { VectorStoreService } from '../embeddings/vector-store.service';
import type { OutboxService } from '../events/outbox.service';
import { ConversationWorker } from './conversation.worker';

function harness(
  overrides: {
    provider?: { isConfigured: boolean; embed: jest.Mock };
    vectorStore?: { isConfigured: boolean; upsertConversationMessages: jest.Mock };
    prisma?: {
      conversation: { findFirst: jest.Mock };
    };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: ConversationWorker;
  provider: { isConfigured: boolean; embed: jest.Mock };
  vectorStore: { isConfigured: boolean; upsertConversationMessages: jest.Mock };
  prisma: { conversation: { findFirst: jest.Mock } };
  outbox: { append: jest.Mock };
} {
  const provider: { isConfigured: boolean; embed: jest.Mock } = overrides.provider ?? {
    isConfigured: true,
    embed: jest.fn(),
  };
  const vectorStore: { isConfigured: boolean; upsertConversationMessages: jest.Mock } =
    overrides.vectorStore ?? { isConfigured: true, upsertConversationMessages: jest.fn() };
  const prisma: { conversation: { findFirst: jest.Mock } } = overrides.prisma ?? {
    conversation: { findFirst: jest.fn() },
  };
  const outbox: { append: jest.Mock } = overrides.outbox ?? { append: jest.fn() };
  const worker = new ConversationWorker(
    provider as unknown as EmbeddingProvider,
    vectorStore as unknown as VectorStoreService,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, provider, vectorStore, prisma, outbox };
}

const job = (name: string, data: Record<string, unknown> = {}) => ({ name, data }) as never;

describe('ConversationWorker', () => {
  it('skips jobs that are not conversation.embed', async () => {
    const { worker } = harness();
    await expect(worker.process(job('document.ingested', {}))).resolves.toEqual({ skipped: true });
  });

  it('skips when embeddings/qdrant/database are not configured', async () => {
    const { worker } = harness({
      provider: { isConfigured: false, embed: jest.fn() },
      vectorStore: { isConfigured: false, upsertConversationMessages: jest.fn() },
    });
    await expect(
      worker.process(job('conversation.embed', { conversationId: 'c1', organizationId: 'o1' })),
    ).resolves.toEqual({ skipped: 'not configured' });
  });

  it('skips a conversation that no longer exists', async () => {
    const { worker, prisma } = harness();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      worker.process(job('conversation.embed', { conversationId: 'gone', organizationId: 'o1' })),
    ).resolves.toEqual({ skipped: 'conversation not found' });
  });

  it('embeds messages in batches and upserts them', async () => {
    const { worker, provider, vectorStore, prisma, outbox } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      customerId: 'cust-1',
      channel: 'WHATSAPP',
      messages: [
        { id: 'msg-1', sender: 'CUSTOMER', body: 'Hi', sentAt: new Date('2026-08-19T09:00:00Z') },
        { id: 'msg-2', sender: 'AGENT', body: 'Hello!', sentAt: new Date('2026-08-19T09:01:00Z') },
      ],
    });
    provider.embed.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const result = await worker.process(
      job('conversation.embed', { conversationId: 'conv-1', organizationId: 'org-1' }),
    );
    expect(provider.embed).toHaveBeenCalledWith(['Hi', 'Hello!']);
    expect(vectorStore.upsertConversationMessages).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      'cust-1',
      'WHATSAPP',
      [
        expect.objectContaining({ messageId: 'msg-1', sender: 'CUSTOMER', vector: [0.1, 0.2] }),
        expect.objectContaining({ messageId: 'msg-2', sender: 'AGENT', vector: [0.3, 0.4] }),
      ],
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'conversation',
        aggregateId: 'conv-1',
        eventType: 'conversation.embedded',
        payload: expect.objectContaining({ messageCount: 2 }),
      }),
    );
    expect(result).toEqual({ conversationId: 'conv-1', embeddedMessages: 2 });
  });

  it('propagates embedding failures for BullMQ retries', async () => {
    const { worker, provider, prisma } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      messages: [{ id: 'msg-1', sender: 'CUSTOMER', body: 'Hi', sentAt: new Date() }],
    });
    provider.embed.mockRejectedValue(
      Object.assign(new Error('api down'), { code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE }),
    );
    await expect(
      worker.process(
        job('conversation.embed', { conversationId: 'conv-1', organizationId: 'org-1' }),
      ),
    ).rejects.toMatchObject({ code: HttpErrorCode.EMBEDDINGS_UNAVAILABLE });
  });

  it('swallows outbox failures', async () => {
    const { worker, provider, vectorStore, prisma, outbox } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      messages: [{ id: 'msg-1', sender: 'CUSTOMER', body: 'Hi', sentAt: new Date() }],
    });
    provider.embed.mockResolvedValue([[0.1]]);
    outbox.append.mockRejectedValue(new Error('db down'));
    const result = await worker.process(
      job('conversation.embed', { conversationId: 'conv-1', organizationId: 'org-1' }),
    );
    expect(vectorStore.upsertConversationMessages).toHaveBeenCalled();
    expect(result).toEqual({ conversationId: 'conv-1', embeddedMessages: 1 });
  });
});
