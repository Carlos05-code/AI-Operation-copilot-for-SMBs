/**
 * NotificationsModule: `POST /notifications/sweep-delivery` — just schedules
 * the delivery-sweep job on the shared `ops-jobs` queue via the global
 * `QueueService`. `EmailProvider` and the worker that actually sends mail
 * live in `notification-worker.module.ts`, split out so
 * `worker-app.module.ts` never instantiates `NotificationController`
 * (DEVOPS_SPEC §3).
 */
import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';

@Module({
  controllers: [NotificationController],
})
export class NotificationsModule {}
