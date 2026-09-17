/**
 * WhatsAppProvider: Twilio client for outbound notification WhatsApp
 * messages (ROADMAP Phase 3 — notifications; API_SPEC §11.14). Fail-soft:
 * without `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM`
 * every call throws `WHATSAPP_UNAVAILABLE` (503).
 *
 * Takes an already-constructed `Twilio` client via DI (built by
 * `NotificationsWorkerModule` from `whatsappProviderConfig()`), matching
 * `EmailProvider`'s pattern of injecting the third-party client directly
 * rather than owning construction — trivial to substitute with a mock in
 * tests. `to`/`from` are expected pre-normalized (E.164-ish digits, no
 * `whatsapp:` prefix); this provider owns adding the channel prefix Twilio's
 * API requires on both addresses.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Twilio } from 'twilio';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';

export interface SendWhatsAppInput {
  to: string;
  body: string;
}

@Injectable()
export class WhatsAppProvider {
  private readonly logger = new Logger(WhatsAppProvider.name);

  constructor(
    @Optional() private readonly client?: Twilio,
    @Optional() private readonly from?: string,
  ) {}

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  async send(input: SendWhatsAppInput): Promise<void> {
    if (!this.client || !this.from) {
      throw new ApiError({
        code: HttpErrorCode.WHATSAPP_UNAVAILABLE,
        status: 503,
        message: 'WhatsApp is not configured',
      });
    }
    try {
      await this.client.messages.create({
        from: `whatsapp:${this.from}`,
        to: `whatsapp:${input.to}`,
        body: input.body,
      });
    } catch (error) {
      this.logger.error(`whatsapp send failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.WHATSAPP_UNAVAILABLE,
        status: 503,
        message: 'WhatsApp is unavailable',
      });
    }
  }
}
