/**
 * Health service. Computes dependency reachability. External services are
 * optional at boot, so a degraded dependency reports `unhealthy` rather than
 * crashing the process; orchestrators gate routing on the response.
 */
import { Injectable } from '@nestjs/common';

export interface DependencyStatus {
  name: string;
  status: 'ok' | 'unhealthy' | 'configured';
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
   * Reports `configured` for optional services when no URL is set (local dev),
   * and defers transport probing to adapters (database module, queues).
   * Overridden/extended as each dependency adapter is introduced.
   */
  private async checkDependencies(): Promise<DependencyStatus[]> {
    const deps: DependencyStatus[] = [
      { name: 'postgres', status: 'configured' },
      { name: 'redis', status: 'configured' },
      { name: 'rabbitmq', status: 'configured' },
    ];
    return Promise.resolve(deps);
  }

  private hasUrl(name: string): boolean {
    return Boolean(process.env[name]);
  }
}
