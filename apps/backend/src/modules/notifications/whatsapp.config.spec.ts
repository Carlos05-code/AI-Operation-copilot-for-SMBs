/**
 * Unit tests — whatsappProviderConfig (pure env parsing).
 */
import { whatsappProviderConfig } from './whatsapp.config';

describe('whatsappProviderConfig', () => {
  it('is null unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM are all set', () => {
    expect(whatsappProviderConfig({})).toBeNull();
    expect(whatsappProviderConfig({ TWILIO_ACCOUNT_SID: 'AC123' })).toBeNull();
    expect(
      whatsappProviderConfig({ TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret' }),
    ).toBeNull();
  });

  it('resolves the config when all three are set', () => {
    const config = whatsappProviderConfig({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret',
      TWILIO_WHATSAPP_FROM: '+14155238886',
    });
    expect(config).toEqual({
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+14155238886',
    });
  });
});
