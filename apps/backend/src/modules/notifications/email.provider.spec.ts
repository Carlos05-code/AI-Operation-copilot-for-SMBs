/**
 * Unit tests — EmailProvider (SMTP send, fail-soft).
 */
import type { Transporter } from 'nodemailer';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { EmailProvider } from './email.provider';

function harness() {
  const transport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }) };
  const provider = new EmailProvider(transport as unknown as Transporter, 'ops@example.com');
  return { provider, transport };
}

describe('EmailProvider', () => {
  it('is unconfigured without a transport', () => {
    const provider = new EmailProvider(undefined, undefined);
    expect(provider.isConfigured).toBe(false);
  });

  it('sends via the injected transport with the configured from address', async () => {
    const { provider, transport } = harness();
    await provider.send({ to: 'owner@acme-demo.local', subject: 'Hi', text: 'body' });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'ops@example.com',
      to: 'owner@acme-demo.local',
      subject: 'Hi',
      text: 'body',
    });
  });

  it('rejects with EMAIL_UNAVAILABLE (503) when not configured', async () => {
    const provider = new EmailProvider(undefined, undefined);
    await expect(provider.send({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toMatchObject({
      code: HttpErrorCode.EMAIL_UNAVAILABLE,
      status: 503,
    });
  });

  it('wraps a transport failure as EMAIL_UNAVAILABLE (503)', async () => {
    const { provider, transport } = harness();
    transport.sendMail.mockRejectedValue(new Error('connection refused'));
    await expect(provider.send({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toMatchObject({
      code: HttpErrorCode.EMAIL_UNAVAILABLE,
      status: 503,
    });
  });
});
