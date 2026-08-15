/**
 * Unit tests — storage endpoint/config normalization.
 */
import { parseEndpoint, storageClientConfig } from './storage.config';

describe('parseEndpoint', () => {
  it('normalizes an http URL with explicit port', () => {
    expect(parseEndpoint('http://localhost:9000')).toEqual({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
    });
  });

  it('marks https endpoints as TLS', () => {
    expect(parseEndpoint('https://minio.internal')).toEqual({
      endPoint: 'minio.internal',
      port: 443,
      useSSL: true,
    });
  });

  it('normalizes a bare host:port', () => {
    expect(parseEndpoint('storage:9000')).toEqual({
      endPoint: 'storage',
      port: 9000,
      useSSL: false,
    });
  });

  it('rejects garbage endpoints', () => {
    expect(() => parseEndpoint('::::')).toThrow(/Invalid STORAGE_ENDPOINT/);
  });
});

describe('storageClientConfig', () => {
  it('returns null when no endpoint is configured', () => {
    expect(storageClientConfig({})).toBeNull();
  });

  it('returns null when the keys are missing', () => {
    expect(storageClientConfig({ STORAGE_ENDPOINT: 'http://localhost:9000' })).toBeNull();
  });

  it('resolves a full config including optional region', () => {
    const config = storageClientConfig({
      STORAGE_ENDPOINT: 'http://localhost:9000',
      STORAGE_ACCESS_KEY: 'ops',
      STORAGE_SECRET_KEY: 'secret',
      STORAGE_REGION: 'us-east-1',
    });
    expect(config).toEqual({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'ops',
      secretKey: 'secret',
      region: 'us-east-1',
    });
  });
});
