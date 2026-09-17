/**
 * Unit tests — WhatsAppProvider (Twilio send, fail-soft).
 */
import type { Twilio } from 'twilio';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { WhatsAppProvider } from './whatsapp.provider';

function harness() {
  const client = { messages: { create: jest.fn().mockResolvedValue({ sid: 'SM1' }) } };
  const provider = new WhatsAppProvider(client as unknown as Twilio, '+14155238886');
  return { provider, client };
}

describe('WhatsAppProvider', () => {
  it('is unconfigured without a client', () => {
    const provider = new WhatsAppProvider(undefined, undefined);
    expect(provider.isConfigured).toBe(false);
  });

  it('sends via the injected client, prefixing both from and to with whatsapp:', async () => {
    const { provider, client } = harness();
    await provider.send({ to: '+15551234567', body: 'Invoice INV-001 is overdue' });
    expect(client.messages.create).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+15551234567',
      body: 'Invoice INV-001 is overdue',
    });
  });

  it('rejects with WHATSAPP_UNAVAILABLE (503) when not configured', async () => {
    const provider = new WhatsAppProvider(undefined, undefined);
    await expect(provider.send({ to: '+15551234567', body: 'x' })).rejects.toMatchObject({
      code: HttpErrorCode.WHATSAPP_UNAVAILABLE,
      status: 503,
    });
  });

  it('wraps a client failure as WHATSAPP_UNAVAILABLE (503)', async () => {
    const { provider, client } = harness();
    client.messages.create.mockRejectedValue(new Error('Twilio 21211: invalid to number'));
    await expect(provider.send({ to: '+15551234567', body: 'x' })).rejects.toMatchObject({
      code: HttpErrorCode.WHATSAPP_UNAVAILABLE,
      status: 503,
    });
  });
});
