/**
 * NotificationsWorkerModule: `EmailProvider` + `WhatsAppProvider` +
 * `NotificationDeliveryWorker`, split out of `notification.module.ts` so
 * `worker-app.module.ts` never instantiates `NotificationController`
 * (DEVOPS_SPEC §3).
 *
 * Each provider is independently inert (fail-soft) without its own env vars
 * — `EmailProvider` without `SMTP_HOST` + `SMTP_FROM`, `WhatsAppProvider`
 * without `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM`
 * — so local runs without either configured still boot; `NotificationDeliveryWorker`
 * leaves affected rows `PENDING`/`FAILED` for a later sweep once configured.
 */
import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { Twilio } from 'twilio';
import { emailProviderConfig } from './email.config';
import { EmailProvider } from './email.provider';
import { whatsappProviderConfig } from './whatsapp.config';
import { WhatsAppProvider } from './whatsapp.provider';
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
    {
      provide: WhatsAppProvider,
      useFactory: () => {
        const config = whatsappProviderConfig();
        if (!config) return new WhatsAppProvider(undefined, undefined);
        const client = new Twilio(config.accountSid, config.authToken);
        return new WhatsAppProvider(client, config.from);
      },
    },
    NotificationDeliveryWorker,
  ],
  exports: [EmailProvider, WhatsAppProvider],
})
export class NotificationsWorkerModule {}
