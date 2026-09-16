/**
 * Health service. Computes dependency reachability. External services are
 * optional at boot: with no env URL set at all the dependency reports
 * `not_configured` (a normal, expected state — not a degradation); with a URL
 * set but no active probe wired up yet, it reports `configured` (no probe);
 * otherwise the probe result (`ok` | `unhealthy`) is reported and readiness
 * degrades on failure. Orchestrators gate routing on the response.
 */
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface DependencyStatus {
  name: string;
  status: 'ok' | 'unhealthy' | 'configured' | 'not_configured';
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  dependencies: DependencyStatus[];
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async report(): Promise<HealthReport> {
    const dependencies = await this.checkDependencies();
    const degraded = dependencies.some((d) => d.status === 'unhealthy');
    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'smb-copilot-api',
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Probes configured dependencies. Transports not yet introduced (redis,
   * rabbitmq) report `configured`/`not_configured` by env presence alone and
   * are extended to a real probe as their adapters land.
   */
  private async checkDependencies(): Promise<DependencyStatus[]> {
    const deps: DependencyStatus[] = [
      { name: 'postgres', status: this.hasUrl('DATABASE_URL') ? 'configured' : 'not_configured' },
      { name: 'redis', status: this.hasUrl('REDIS_URL') ? 'configured' : 'not_configured' },
      { name: 'rabbitmq', status: this.hasUrl('RABBITMQ_URL') ? 'configured' : 'not_configured' },
      { name: 'minio', status: this.hasUrl('STORAGE_ENDPOINT') ? 'configured' : 'not_configured' },
      {
        name: 'embeddings',
        status: this.hasUrl('EMBEDDINGS_API_URL') ? 'configured' : 'not_configured',
      },
      { name: 'qdrant', status: this.hasUrl('QDRANT_URL') ? 'configured' : 'not_configured' },
      { name: 'search', status: this.hasUrl('OPENSEARCH_URL') ? 'configured' : 'not_configured' },
      { name: 'graph', status: this.hasUrl('NEO4J_URI') ? 'configured' : 'not_configured' },
      { name: 'llm', status: this.hasUrl('LLM_API_URL') ? 'configured' : 'not_configured' },
    ];

    if (this.prisma && process.env.DATABASE_URL) {
      deps[0] = await this.probePostgres();
    }
    return deps;
  }

  private async probePostgres(): Promise<DependencyStatus> {
    try {
      await this.prisma?.ping();
      return { name: 'postgres', status: 'ok' };
    } catch (error) {
      return { name: 'postgres', status: 'unhealthy', detail: String(error) };
    }
  }

  private hasUrl(name: string): boolean {
    return Boolean(process.env[name]);
  }
}
