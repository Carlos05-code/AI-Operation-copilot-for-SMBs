/**
 * QueueService: typed enqueue facade over the BullMQ queues (ADR-0007).
 *
 * Application services call `enqueue(...)` instead of touching BullMQ
 * directly, keeping job scheduling for notification delivery, OCR batches,
 * and weekly summaries behind one seam.
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { QUEUE_AI_JOBS, QUEUE_NOTIFICATIONS, QueueName } from './queue.constants';

@Injectable()
export class QueueService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS) notifications: Queue,
    @InjectQueue(QUEUE_AI_JOBS) aiJobs: Queue,
  ) {
    this.queues = { notifications, 'ai-jobs': aiJobs };
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
