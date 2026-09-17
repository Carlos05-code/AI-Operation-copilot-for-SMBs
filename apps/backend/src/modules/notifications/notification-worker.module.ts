/**
 * NotificationsWorkerModule: `EmailProvider` + `NotificationDeliveryWorker`,
 * split out of `notification.module.ts` so `worker-app.module.ts` never
 * instantiates `NotificationController` (DEVOPS_SPEC §3).
 *
 * The module is inert without `SMTP_HOST` + `SMTP_FROM` (fail-soft):
 * `NotificationDeliveryWorker` leaves rows `PENDING`/`FAILED` for a later
 * sweep once SMTP is configured, so local runs without an SMTP server still
 * boot. WhatsApp delivery is deferred — see `notification.constants.ts`.
 */
import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { emailProviderConfig } from './email.config';
import { EmailProvider } from './email.provider';
import { NotificationDeliveryWorker } from './notification.delivery.worker';

@Module({
  providers: [
    {
      provide: EmailProvider,
      useFactory: () => {
        const config = emailProviderConfig();
        if (!config) return new EmailProvider(undefined, undefined);
        const transport = createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.user ? { user: config.user, pass: config.password } : undefined,
        });
        return new EmailProvider(transport, config.from);
      },
    },
    NotificationDeliveryWorker,
  ],
  exports: [EmailProvider],
})
export class NotificationsWorkerModule {}
