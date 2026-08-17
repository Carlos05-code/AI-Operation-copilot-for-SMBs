/**
 * BullMQ queue names + job helpers (ADR-0007, ADR-0013).
 */
import type { JobsOptions } from 'bullmq';

export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_AI_JOBS = 'ai-jobs';
export const QUEUE_SEARCH_JOBS = 'search-jobs';

export const QUEUES = [QUEUE_NOTIFICATIONS, QUEUE_AI_JOBS, QUEUE_SEARCH_JOBS] as const;
export type QueueName = (typeof QUEUES)[number];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};
