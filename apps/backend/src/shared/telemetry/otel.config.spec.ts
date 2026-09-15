/**
 * Unit tests — otelConfig (pure env parsing).
 */
import { otelConfig } from './otel.config';

describe('otelConfig', () => {
  it('is null without OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(otelConfig({})).toBeNull();
  });

  it('resolves the endpoint (trailing slashes trimmed) and defaults the service name', () => {
    expect(otelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' })).toEqual({
      otlpEndpoint: 'http://collector:4318',
      serviceName: 'smb-copilot-api',
    });
  });

  it('honors an explicit OTEL_SERVICE_NAME', () => {
    expect(
      otelConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_SERVICE_NAME: 'smb-copilot-worker',
      }),
    ).toMatchObject({ serviceName: 'smb-copilot-worker' });
  });
});
