/**
 * NestJS module that bundles the shared kernel: request context, envelope,
 * logger, exception filter, and telemetry. Consumers import `CoreModule` for
 * these.
 */
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './envelope/envelope.interceptor.js';
import { PinoLoggerService } from './logger/pino-logger.service.js';
import { AppMetricsService } from './telemetry/app-metrics.service.js';
import { TelemetryInterceptor } from './telemetry/telemetry.interceptor.js';

@Global()
@Module({
  providers: [
    PinoLoggerService,
    AppMetricsService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TelemetryInterceptor },
  ],
  exports: [PinoLoggerService, AppMetricsService],
})
export class CoreModule {}
