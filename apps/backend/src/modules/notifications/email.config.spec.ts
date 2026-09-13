/**
 * Unit tests — emailProviderConfig (pure env parsing).
 */
import { emailProviderConfig } from './email.config';

describe('emailProviderConfig', () => {
  it('is null without SMTP_HOST or SMTP_FROM', () => {
    expect(emailProviderConfig({})).toBeNull();
    expect(emailProviderConfig({ SMTP_HOST: 'smtp.example.com' })).toBeNull();
    expect(emailProviderConfig({ SMTP_FROM: 'ops@example.com' })).toBeNull();
  });

  it('defaults to port 587, insecure, and no auth', () => {
    const config = emailProviderConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'ops@example.com',
    });
    expect(config).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: undefined,
      password: undefined,
      from: 'ops@example.com',
    });
  });

  it('flags secure at port 465 and carries through credentials', () => {
    const config = emailProviderConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'ops@example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'ops',
      SMTP_PASSWORD: 'secret',
    });
    expect(config).toMatchObject({ port: 465, secure: true, user: 'ops', password: 'secret' });
  });
});
