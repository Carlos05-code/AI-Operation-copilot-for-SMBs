/**
 * Unit tests — QueueService (enqueue delegation, queue-depth gauge sampling).
 */
import type { Queue } from 'bullmq';
import type { AppMetricsService } from '../../shared/telemetry/app-metrics.service';
import { QueueService } from './queue.service';

function fakeQueue(waiting: number | Error): {
  queue: Queue;
  add: jest.Mock;
  getWaitingCount: jest.Mock;
} {
  const add = jest.fn().mockResolvedValue({ id: 'job-1' });
  const getWaitingCount =
    waiting instanceof Error
      ? jest.fn().mockRejectedValue(waiting)
      : jest.fn().mockResolvedValue(waiting);
  return { queue: { add, getWaitingCount } as unknown as Queue, add, getWaitingCount };
}

function harness(waitingByQueue: Record<string, number | Error> = {}) {
  const metrics = { registerQueueDepth: jest.fn() };
  const queues = {
    notifications: fakeQueue(waitingByQueue.notifications ?? 0),
    'ai-jobs': fakeQueue(waitingByQueue['ai-jobs'] ?? 0),
    'search-jobs': fakeQueue(waitingByQueue['search-jobs'] ?? 0),
    'graph-jobs': fakeQueue(waitingByQueue['graph-jobs'] ?? 0),
    'summary-jobs': fakeQueue(waitingByQueue['summary-jobs'] ?? 0),
    'ops-jobs': fakeQueue(waitingByQueue['ops-jobs'] ?? 0),
  };
  const service = new QueueService(
    queues.notifications.queue,
    queues['ai-jobs'].queue,
    queues['search-jobs'].queue,
    queues['graph-jobs'].queue,
    queues['summary-jobs'].queue,
    queues['ops-jobs'].queue,
    metrics as unknown as AppMetricsService,
  );
  return { service, metrics, queues };
}

describe('QueueService.enqueue', () => {
  it('adds a job to the named queue and returns its id', async () => {
    const { service, queues } = harness();
    const id = await service.enqueue('ai-jobs', 'document.embed', { docId: 'd-1' });
    expect(queues['ai-jobs'].add).toHaveBeenCalledWith(
      'document.embed',
      { docId: 'd-1' },
      undefined,
    );
    expect(id).toBe('job-1');
  });
});

describe('QueueService queue-depth gauge', () => {
  it('registers a depth sampler on construction', () => {
    const { metrics } = harness();
    expect(metrics.registerQueueDepth).toHaveBeenCalledWith(expect.any(Function));
  });

  it('samples every queue and omits any that fail to report', async () => {
    const { metrics } = harness({ 'ai-jobs': 3, 'ops-jobs': new Error('redis down') });
    const sample = metrics.registerQueueDepth.mock.calls[0][0] as () => Promise<
      Array<{ queue: string; waiting: number }>
    >;

    const depths = await sample();

    expect(depths).toEqual(
      expect.arrayContaining([
        { queue: 'ai-jobs', waiting: 3 },
        { queue: 'notifications', waiting: 0 },
      ]),
    );
    expect(depths.find((d) => d.queue === 'ops-jobs')).toBeUndefined();
  });
});
