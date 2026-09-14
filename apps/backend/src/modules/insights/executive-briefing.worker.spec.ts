/**
 * Unit tests — ExecutiveBriefingWorker (signals, LLM briefing, persist, fail-soft).
 */
import type { Job } from 'bullmq';
import { LlmProvider } from '../chat/llm.provider';
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { ExecutiveBriefingWorker } from './executive-briefing.worker';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function harness(overrides: { llm?: { isConfigured: boolean; complete: jest.Mock } } = {}) {
  const zeroAggregate = { _sum: { total: decimal('0.00') } };
  const prisma = {
    invoice: { aggregate: jest.fn().mockResolvedValue(zeroAggregate) },
    task: { count: jest.fn().mockResolvedValue(0) },
    product: { count: jest.fn().mockResolvedValue(0) },
    purchaseRecommendation: { count: jest.fn().mockResolvedValue(0) },
    appointment: { count: jest.fn().mockResolvedValue(0) },
    notification: { count: jest.fn().mockResolvedValue(0) },
    executiveBriefing: { create: jest.fn().mockResolvedValue({ id: 'brief-1' }) },
  };
  const llm = overrides.llm ?? { isConfigured: true, complete: jest.fn() };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const worker = new ExecutiveBriefingWorker(
    { isConfigured: llm.isConfigured, complete: llm.complete } as unknown as LlmProvider,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { worker, prisma, llm, outbox };
}

const job = (
  overrides: Partial<Job<{ organizationId: string }>> = {},
): Job<{ organizationId: string }> =>
  ({
    name: 'insight.executive.briefing',
    data: { organizationId: 'org-1' },
    ...overrides,
  }) as unknown as Job<{ organizationId: string }>;

describe('ExecutiveBriefingWorker', () => {
  it('generates and persists a briefing from validated LLM output', async () => {
    const { worker, prisma, llm, outbox } = harness();
    llm.complete.mockResolvedValue(
      JSON.stringify({
        summary: 'Revenue is flat and three invoices are overdue.',
        highlights: ['No new risks this week'],
        risks: ['3 invoices are overdue'],
        focusAreas: ['Follow up on overdue invoices'],
      }),
    );

    const result = await worker.process(job());

    expect(result).toMatchObject({ generated: true, briefingId: 'brief-1' });
    expect(prisma.executiveBriefing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          summary: 'Revenue is flat and three invoices are overdue.',
          highlights: ['No new risks this week'],
          risks: ['3 invoices are overdue'],
          focusAreas: ['Follow up on overdue invoices'],
          signals: expect.objectContaining({
            revenue: expect.objectContaining({ total: '0.00' }),
            appointments: expect.objectContaining({ upcomingWithinDays: 7 }),
          }),
        }),
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'insight.executive.generated',
        payload: expect.objectContaining({ organizationId: 'org-1', briefingId: 'brief-1' }),
      }),
    );
  });

  it('truncates highlight/risk/focus-area lists beyond 5 entries', async () => {
    const { worker, prisma, llm } = harness();
    const many = Array.from({ length: 8 }, (_, i) => `point ${i}`);
    llm.complete.mockResolvedValue(
      JSON.stringify({ summary: 'x', highlights: many, risks: [], focusAreas: [] }),
    );

    await worker.process(job());

    const data = prisma.executiveBriefing.create.mock.calls[0][0].data;
    expect(data.highlights).toHaveLength(5);
  });

  it('throws on malformed model output so BullMQ retries', async () => {
    const { worker, llm } = harness();
    llm.complete.mockResolvedValue('{"summary":"x","highlights":"not an array"}');
    await expect(worker.process(job())).rejects.toThrow('malformed JSON');
  });

  it('throws when a list entry is not a string', async () => {
    const { worker, llm } = harness();
    llm.complete.mockResolvedValue(
      JSON.stringify({ summary: 'x', highlights: [1, 2], risks: [], focusAreas: [] }),
    );
    await expect(worker.process(job())).rejects.toThrow('malformed JSON');
  });

  it('skips when there is no database or no LLM', async () => {
    const noDb = new ExecutiveBriefingWorker(
      { isConfigured: true } as unknown as LlmProvider,
      undefined,
      undefined,
    );
    await expect(noDb.process(job())).resolves.toMatchObject({ skipped: 'not configured' });

    const { worker } = harness({ llm: { isConfigured: false, complete: jest.fn() } });
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'llm not configured' });
  });

  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    const result = await worker.process(job({ name: 'conversation.embed' }));
    expect(result.skipped).toBe('name mismatch');
  });

  it('swallows outbox failures after persisting', async () => {
    const { worker, llm, outbox } = harness();
    llm.complete.mockResolvedValue(
      JSON.stringify({ summary: 'x', highlights: [], risks: [], focusAreas: [] }),
    );
    outbox.append.mockRejectedValue(new Error('db down'));
    await expect(worker.process(job())).resolves.toMatchObject({ generated: true });
  });
});
