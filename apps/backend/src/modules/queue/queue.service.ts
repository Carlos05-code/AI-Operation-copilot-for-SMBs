/**
 * QueueService: typed enqueue facade over the BullMQ queues (ADR-0007).
 *
 * Application services call `enqueue(...)` instead of touching BullMQ
 * directly, keeping job scheduling for notification delivery, OCR batches,
 * and weekly summaries behind one seam. Also registers the `queue.jobs.waiting`
 * gauge (DEVOPS_SPEC §8 queue-backlog alerting) — sampled per queue on every
 * Prometheus scrape, one queue's Redis error never blanks the others.
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { AppMetricsService } from '../../shared/telemetry/app-metrics.service';
import {
  QUEUE_AI_JOBS,
  QUEUE_GRAPH_JOBS,
  QUEUE_NOTIFICATIONS,
  QUEUE_OPS_JOBS,
  QUEUE_SEARCH_JOBS,
  QUEUE_SUMMARY_JOBS,
  QueueName,
} from './queue.constants';

@Injectable()
export class QueueService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS) notifications: Queue,
    @InjectQueue(QUEUE_AI_JOBS) aiJobs: Queue,
    @InjectQueue(QUEUE_SEARCH_JOBS) searchJobs: Queue,
    @InjectQueue(QUEUE_GRAPH_JOBS) graphJobs: Queue,
    @InjectQueue(QUEUE_SUMMARY_JOBS) summaryJobs: Queue,
    @InjectQueue(QUEUE_OPS_JOBS) opsJobs: Queue,
    metrics: AppMetricsService,
  ) {
    this.queues = {
      notifications,
      'ai-jobs': aiJobs,
      'search-jobs': searchJobs,
      'graph-jobs': graphJobs,
      'summary-jobs': summaryJobs,
      'ops-jobs': opsJobs,
    };
    metrics.registerQueueDepth(() => this.sampleQueueDepths());
  }

  private async sampleQueueDepths(): Promise<Array<{ queue: string; waiting: number }>> {
    const samples = await Promise.allSettled(
      Object.entries(this.queues).map(async ([queue, bullQueue]) => ({
        queue,
        waiting: await bullQueue.getWaitingCount(),
      })),
    );
    return samples
      .filter(
        (sample): sample is PromiseFulfilledResult<{ queue: string; waiting: number }> =>
          sample.status === 'fulfilled',
      )
      .map((sample) => sample.value);
  }

  /** Adds a job to the named queue with default retry/backoff options. */
  async enqueue(
    queueName: QueueName,
    jobName: string,
    data: unknown,
    opts?: JobsOptions,
  ): Promise<string | undefined> {
    const job = await this.queues[queueName].add(jobName, data, opts);
    return job?.id;
  }
}
