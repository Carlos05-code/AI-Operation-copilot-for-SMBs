/**
 * Unit tests — ConversationSummaryWorker (LLM summaries, idempotency).
 */
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { CONVERSATION_SUMMARY_CONTEXT_CHARS } from './conversation.constants';
import { ConversationSummaryWorker } from './conversation.summary.worker';

function harness(
  overrides: {
    prisma?: {
      conversation?: { findFirst: jest.Mock; update: jest.Mock };
    };
    llm?: { isConfigured: boolean; complete: jest.Mock };
    outbox?: { append: jest.Mock };
  } = {},
): {
  worker: ConversationSummaryWorker;
  prisma: { conversation: { findFirst: jest.Mock; update: jest.Mock } };
  llm: { isConfigured: boolean; complete: jest.Mock };
  outbox: { append: jest.Mock };
} {
  const prisma = {
    conversation: overrides.prisma?.conversation ?? {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const llm = overrides.llm ?? { isConfigured: true, complete: jest.fn() };
  const outbox = overrides.outbox ?? { append: jest.fn() };
  const worker = new ConversationSummaryWorker(
    { isConfigured: llm.isConfigured, complete: llm.complete } as unknown as LlmProvider,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, llm, outbox };
}

const message = (index: number, at = new Date(Date.UTC(2026, 7, 19, 8, index))) => ({
  id: `m-${index}`,
  conversationId: 'conv-1',
  sender: index % 2 === 0 ? 'CUSTOMER' : 'AGENT',
  body: `Message ${index}`,
  sentAt: at,
  externalId: null,
  createdAt: at,
});

function job(
  overrides: Partial<Job<{ conversationId: string; organizationId: string }>> = {},
): Job<{
  conversationId: string;
  organizationId: string;
}> {
  return {
    name: 'conversation.summarize',
    data: { conversationId: 'conv-1', organizationId: 'org-1' },
    ...overrides,
  } as unknown as Job<{ conversationId: string; organizationId: string }>;
}

describe('ConversationSummaryWorker', () => {
  it('summarizes a conversation, persists the result, and emits the event', async () => {
    const { worker, prisma, llm, outbox } = harness();
    const messages = [message(0), message(1), message(2)];
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      channel: 'WHATSAPP',
      title: 'Pricing question',
      summary: null,
      summaryGeneratedAt: null,
      messages,
    });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    llm.complete.mockResolvedValue(
      JSON.stringify({
        summary: 'Customer asked about pricing tiers.',
        keyPoints: ['Wants the annual plan', 'Asked about refunds'],
      }),
    );
    const result = await worker.process(job());
    expect(result).toEqual({ conversationId: 'conv-1', summarized: true });
    expect(llm.complete).toHaveBeenCalledWith(
      expect.stringContaining('customer-support analyst'),
      expect.stringContaining('[Customer] Message 0'),
      expect.any(Number),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        summary: 'Customer asked about pricing tiers.',
        summaryGeneratedAt: expect.any(Date),
      },
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'conversation.summarized',
        payload: expect.objectContaining({
          keyPoints: ['Wants the annual plan', 'Asked about refunds'],
        }),
      }),
    );
  });

  it('skips when the existing summary is already fresher than the last message', async () => {
    const { worker, prisma, llm } = harness();
    const at = new Date('2026-08-19T09:00:00Z');
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: 'already summarized',
      summaryGeneratedAt: new Date('2026-08-19T10:00:00Z'),
      messages: [message(0, at)],
    });
    const result = await worker.process(job());
    expect(result.skipped).toBe('already summarized');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('regenerates when new messages arrived after the summary', async () => {
    const { worker, prisma, llm } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: 'stale',
      summaryGeneratedAt: new Date('2026-08-19T09:00:00Z'),
      messages: [
        message(0, new Date('2026-08-19T08:00:00Z')),
        message(1, new Date('2026-08-19T10:00:00Z')),
      ],
    });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    llm.complete.mockResolvedValue('{"summary":"fresh","keyPoints":[]}');
    const result = await worker.process(job());
    expect(result.summarized).toBe(true);
  });

  it('skips without a database, when the conversation is missing, or when the LLM is unconfigured', async () => {
    const unconfigured = new ConversationSummaryWorker(
      { isConfigured: false } as unknown as LlmProvider,
      undefined,
      undefined,
    );
    await expect(unconfigured.process(job())).resolves.toMatchObject({ skipped: 'not configured' });

    const { worker, prisma } = harness();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(worker.process(job())).resolves.toMatchObject({
      skipped: 'conversation not found',
    });

    const { worker: worker2, prisma: prisma2 } = harness({
      llm: { isConfigured: false, complete: jest.fn() },
    });
    prisma2.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: null,
      summaryGeneratedAt: null,
      messages: [message(0)],
    });
    await expect(worker2.process(job())).resolves.toMatchObject({ skipped: 'llm not configured' });
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'conversation.embed' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('throws when the model returns a malformed payload so BullMQ retries', async () => {
    const { worker, prisma, llm } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: null,
      summaryGeneratedAt: null,
      messages: [message(0)],
    });
    llm.complete.mockResolvedValue('not json at all');
    await expect(worker.process(job())).rejects.toThrow('malformed JSON');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('windows the transcript to the tail when the conversation is huge', async () => {
    const { worker, prisma, llm } = harness();
    const big = Array.from({ length: 60 }, (_, index) => message(index, undefined));
    big.forEach((entry) => {
      entry.body = `Message ${entry.id} ` + 'x'.repeat(500);
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: null,
      summaryGeneratedAt: null,
      messages: big,
    });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    llm.complete.mockResolvedValue('{"summary":"ok","keyPoints":[]}');
    await worker.process(job());
    const userPrompt = llm.complete.mock.calls[0][1] as string;
    expect(userPrompt).toContain('older messages were omitted');
    expect(userPrompt.length).toBeLessThanOrEqual(CONVERSATION_SUMMARY_CONTEXT_CHARS + 500);
    expect(userPrompt).toContain('Message m-59');
  });

  it('fits a normal transcript into the prompt without the truncation note', async () => {
    const { worker, prisma, llm } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: null,
      summaryGeneratedAt: null,
      messages: [message(0), message(1)],
    });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    llm.complete.mockResolvedValue('{"summary":"ok","keyPoints":[]}');
    await worker.process(job());
    const userPrompt = llm.complete.mock.calls[0][1] as string;
    expect(userPrompt).not.toContain('older messages were omitted');
  });

  it('swallows outbox failures after persisting', async () => {
    const { worker, prisma, llm, outbox } = harness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      channel: 'WHATSAPP',
      summary: null,
      summaryGeneratedAt: null,
      messages: [message(0)],
    });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    llm.complete.mockResolvedValue('{"summary":"ok","keyPoints":[]}');
    outbox.append.mockRejectedValue(new Error('db down'));
    await expect(worker.process(job())).resolves.toMatchObject({ summarized: true });
  });
});
