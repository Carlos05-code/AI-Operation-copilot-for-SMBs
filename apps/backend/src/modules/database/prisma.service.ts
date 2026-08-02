/**
 * Prisma service — the single data-access entrypoint for PostgreSQL.
 * Connects lazily at boot when DATABASE_URL is present (local/dev boot without
 * a database stays possible; readiness reports `configured` in that case).
 */
import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PinoLoggerService } from '../../shared/logger/pino-logger.service.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Optional() private readonly logger?: PinoLoggerService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      this.logger?.warn(
        '[db] DATABASE_URL not set — skipping connection (health reports configured)',
      );
      return;
    }
    try {
      await this.$connect();
      this.logger?.debug('[db] connected');
    } catch (error) {
      this.logger?.error('[db] connection failed', { error: String(error) });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness probe: `SELECT 1`. Throws when unreachable. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
