/**
 * QueueModule: BullMQ job queues on Redis (ADR-0007, ADR-0013).
 *
 * Registers the `notifications` and `ai-jobs` queues with exponential-retry
 * defaults and a connection derived from `REDIS_URL`. Fail-soft by design:
 * BullMQ connects lazily, so booting without Redis is fine; only enqueue
 * attempts fail.
 */
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { DEFAULT_JOB_OPTIONS, QUEUE_AI_JOBS, QUEUE_NOTIFICATIONS } from './queue.constants';
import { redisConnectionOptions } from './redis.config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: redisConnectionOptions(process.env.REDIS_URL),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS }, { name: QUEUE_AI_JOBS }),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
