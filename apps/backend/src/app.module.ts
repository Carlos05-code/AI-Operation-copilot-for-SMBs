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
import { AuthModule } from './modules/auth/auth.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { RequestIdMiddleware } from './shared/context/request-id.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw: Record<string, unknown>) => validateEnv(raw),
    }),
    CoreModule,
    AuthModule,
    EventsModule,
    QueueModule,
    StorageModule,
    IngestionModule,
    EmbeddingsModule,
    SearchModule,
    GraphModule,
    ChatModule,
    HealthModule,
    OpenApiModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
