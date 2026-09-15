/**
 * Unit tests — lokiConfig (pure env parsing).
 */
import { lokiConfig } from './loki.config';

describe('lokiConfig', () => {
  it('is null without LOKI_URL', () => {
    expect(lokiConfig({})).toBeNull();
  });

  it('resolves the host with trailing slashes trimmed', () => {
    expect(lokiConfig({ LOKI_URL: 'http://loki:3100/' })).toEqual({ host: 'http://loki:3100' });
  });
});
