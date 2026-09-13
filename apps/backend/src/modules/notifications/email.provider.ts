/**
 * EmailProvider: SMTP client for outbound notification email
 * (ROADMAP Phase 3 — notifications). Fail-soft: without `SMTP_HOST` +
 * `SMTP_FROM` every call throws `EMAIL_UNAVAILABLE` (503).
 *
 * Takes an already-constructed `Transporter` via DI (built by
 * `NotificationsModule` from `emailProviderConfig()`), matching
 * `VectorStoreService`'s pattern of injecting the third-party client
 * directly rather than owning construction — the transport is trivial to
 * substitute with a mock in tests.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);

  constructor(
    @Optional() private readonly transport?: Transporter,
    @Optional() private readonly from?: string,
  ) {}

  get isConfigured(): boolean {
    return this.transport !== undefined;
  }

  async send(input: SendEmailInput): Promise<void> {
    if (!this.transport || !this.from) {
      throw new ApiError({
        code: HttpErrorCode.EMAIL_UNAVAILABLE,
        status: 503,
        message: 'Email is not configured',
      });
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    } catch (error) {
      this.logger.error(`email send failed: ${(error as Error)?.message}`);
      throw new ApiError({
        code: HttpErrorCode.EMAIL_UNAVAILABLE,
        status: 503,
        message: 'Email is unavailable',
      });
    }
  }
}
