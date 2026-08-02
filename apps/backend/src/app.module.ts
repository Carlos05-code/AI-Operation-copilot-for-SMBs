/**
 * Root application module — wires the shared kernel, configuration, and
 * feature modules (BACKEND_SPEC §2 layout).
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './shared/core.module.js';
import { validateEnv } from './shared/config/env.validation.js';
import { HealthModule } from './modules/health/health.module.js';
import { OpenApiModule } from './modules/openapi/openapi.module.js';
import { RequestIdMiddleware } from './shared/context/request-id.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw: Record<string, unknown>) => validateEnv(raw),
    }),
    CoreModule,
    HealthModule,
    OpenApiModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
