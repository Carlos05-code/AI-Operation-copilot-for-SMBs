/**
 * Object storage configuration (SECURITY_SPEC §10).
 *
 * `STORAGE_ENDPOINT` accepts `http://host:port`, `https://host` or a bare
 * `host:port`; the endpoint is normalized into the `endPoint`/`port`/`useSSL`
 * triple the MinIO client expects. Without `STORAGE_ENDPOINT` (or its keys)
 * the client is `null` and the storage module is inert, so local runs without
 * MinIO still boot.
 */
import { Client } from 'minio';

export interface StorageEndpointParts {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

export interface StorageClientConfig extends StorageEndpointParts {
  accessKey: string;
  secretKey: string;
  region?: string;
}

/** Normalizes a `STORAGE_ENDPOINT` value into client-compatible parts. */
export function parseEndpoint(endpoint: string): StorageEndpointParts {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) {
    const url = new URL(endpoint);
    return {
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
    };
  }
  const match = /^([^/:]+)(?::(\d+))?$/.exec(endpoint.trim());
  if (!match) {
    throw new Error(`Invalid STORAGE_ENDPOINT: "${endpoint}"`);
  }
  return { endPoint: match[1], port: match[2] ? Number(match[2]) : 80, useSSL: false };
}

/** Resolves the client config from the environment; `null` when not configured. */
export function storageClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageClientConfig | null {
  const endpoint = env.STORAGE_ENDPOINT;
  const accessKey = env.STORAGE_ACCESS_KEY;
  const secretKey = env.STORAGE_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) return null;
  return {
    ...parseEndpoint(endpoint),
    accessKey,
    secretKey,
    region: env.STORAGE_REGION || undefined,
  };
}

/** Builds the MinIO client from a resolved config. */
export function createStorageClient(config: StorageClientConfig): Client {
  return new Client({
    endPoint: config.endPoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });
}
