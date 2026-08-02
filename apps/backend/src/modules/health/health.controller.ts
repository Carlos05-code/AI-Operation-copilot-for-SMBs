/**
 * Health endpoints — liveness and readiness probes for orchestrators.
 *
 * `GET /api/v1/health` — deep readiness: DB, Redis, queues reachable.
 * `GET /api/v1/health/live` — process liveness (always 200 when serving).
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService, HealthReport } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness probe with dependency status' })
  readiness(): Promise<HealthReport> {
    return Promise.resolve(this.healthService.report());
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  liveness(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
