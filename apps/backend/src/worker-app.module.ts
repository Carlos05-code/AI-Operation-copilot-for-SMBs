/**
 * Root module for `main-worker.ts` — the clean HTTP/worker split
 * `main-worker.ts`'s own history (and DEVOPS_SPEC §3) named as the real
 * fix still owed: every feature module that has both a controller and a
 * BullMQ worker (`task.module.ts` was the typical example) is now split
 * into an HTTP half (`<feature>.module.ts`, imported by `app.module.ts`
 * only) and a worker half (`<feature>-worker.module.ts`, imported here
 * only). This module imports only the worker halves, plus the same shared
 * infra `app.module.ts` uses — no `@Controller` class is reachable from
 * this module tree, so `createApplicationContext` (main-worker.ts) never
 * instantiates one.
 *
 * `AuthModule` is deliberately absent: nothing under a worker half depends
 * on it (auth/RBAC is an HTTP-request concern — `JwtAuthGuard`/`RolesGuard`/
 * `TenancyGuard` all key off `ExecutionContext.switchToHttp()`), so the
 * worker process never fetches Keycloak's JWKS or spins up those guards at
 * all. `HealthModule`/`OpenApiModule` are equally HTTP-only and absent for
 * the same reason — `DatabaseModule` (which `HealthModule` is the only
 * *other* importer of) is imported directly here instead, since nothing
 * else in this tree would otherwise load it and `PrismaService` is needed
 * everywhere.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './shared/core.module.js';
import { validateEnv } from './shared/config/env.validation.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { AppointmentsWorkerModule } from './modules/appointments/appointment-worker.module.js';
import { ConversationsWorkerModule } from './modules/conversations/conversation-worker.module.js';
import { InsightsWorkerModule } from './modules/insights/insights-worker.module.js';
import { InventoryWorkerModule } from './modules/inventory/inventory-worker.module.js';
import { InvoicesWorkerModule } from './modules/invoices/invoice-worker.module.js';
import { NotificationsWorkerModule } from './modules/notifications/notification-worker.module.js';
import { PurchasingWorkerModule } from './modules/purchasing/purchasing-worker.module.js';
import { SearchWorkerModule } from './modules/search/search-worker.module.js';
import { TasksWorkerModule } from './modules/tasks/task-worker.module.js';
import { WorkflowsWorkerModule } from './modules/workflows/workflow-worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw: Record<string, unknown>) => validateEnv(raw),
    }),
    CoreModule,
    DatabaseModule,
    EventsModule,
    QueueModule,
    StorageModule,
    EmbeddingsModule,
    GraphModule,
    AppointmentsWorkerModule,
    ConversationsWorkerModule,
    InsightsWorkerModule,
    InventoryWorkerModule,
    InvoicesWorkerModule,
    NotificationsWorkerModule,
    PurchasingWorkerModule,
    SearchWorkerModule,
    TasksWorkerModule,
    WorkflowsWorkerModule,
  ],
})
export class WorkerAppModule {}
