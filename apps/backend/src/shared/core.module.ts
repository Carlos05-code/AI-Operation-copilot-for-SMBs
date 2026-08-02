/**
 * NestJS module that bundles the shared kernel: request context, envelope,
 * logger, and exception filter. Consumers import `CoreModule` for these.
 */
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './envelope/envelope.interceptor.js';
import { PinoLoggerService } from './logger/pino-logger.service.js';

@Global()
@Module({
  providers: [
    PinoLoggerService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
  exports: [PinoLoggerService],
})
export class CoreModule {}
