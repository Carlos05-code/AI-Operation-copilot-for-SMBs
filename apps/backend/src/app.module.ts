/**
 * Root application module — wires the shared kernel, configuration, and
 * feature modules (BACKEND_SPEC §2 layout).
 *
 * Imports both the HTTP half AND the worker half of every split feature
 * module (DEVOPS_SPEC §3): `api` still does in-process BullMQ processing,
 * exactly as `infrastructure/kubernetes/README.md` documents ("worker is
 * additional capacity... it doesn't replace api's own processing"). Only
 * `worker-app.module.ts` (main-worker.ts) is restricted to worker halves
 * only — that asymmetry, not symmetry with this module, is what keeps
 * `@Controller`s out of the worker process. Without the worker-half imports
 * here, local dev (`start`/`start:dev` only ever boots `main.ts`, and no
 * compose service or script also runs `main-worker.ts`) silently processed
 * zero jobs for every one of these ten queues.
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
import { StorageHttpModule } from './modules/storage/storage-http.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SearchWorkerModule } from './modules/search/search-worker.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { ConversationsModule } from './modules/conversations/conversation.module.js';
import { ConversationsWorkerModule } from './modules/conversations/conversation-worker.module.js';
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js';
import { ConnectorsModule } from './modules/connectors/connector.module.js';
import { AppointmentsModule } from './modules/appointments/appointment.module.js';
import { AppointmentsWorkerModule } from './modules/appointments/appointment-worker.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ForecastingModule } from './modules/forecasting/forecasting.module.js';
import { InsightsModule } from './modules/insights/insights.module.js';
import { InsightsWorkerModule } from './modules/insights/insights-worker.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { InventoryWorkerModule } from './modules/inventory/inventory-worker.module.js';
import { InvoicesModule } from './modules/invoices/invoice.module.js';
import { InvoicesWorkerModule } from './modules/invoices/invoice-worker.module.js';
import { NotificationsModule } from './modules/notifications/notification.module.js';
import { NotificationsWorkerModule } from './modules/notifications/notification-worker.module.js';
import { PurchasingModule } from './modules/purchasing/purchasing.module.js';
import { PurchasingWorkerModule } from './modules/purchasing/purchasing-worker.module.js';
import { TasksModule } from './modules/tasks/task.module.js';
import { TasksWorkerModule } from './modules/tasks/task-worker.module.js';
import { WorkflowsModule } from './modules/workflows/workflow.module.js';
import { WorkflowsWorkerModule } from './modules/workflows/workflow-worker.module.js';
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
    StorageHttpModule,
    IngestionModule,
    EmbeddingsModule,
    SearchModule,
    SearchWorkerModule,
    GraphModule,
    ChatModule,
    ConversationsModule,
    ConversationsWorkerModule,
    KnowledgeModule,
    ConnectorsModule,
    AppointmentsModule,
    AppointmentsWorkerModule,
    DashboardModule,
    ForecastingModule,
    InsightsModule,
    InsightsWorkerModule,
    InventoryModule,
    InventoryWorkerModule,
    InvoicesModule,
    InvoicesWorkerModule,
    NotificationsModule,
    NotificationsWorkerModule,
    PurchasingModule,
    PurchasingWorkerModule,
    TasksModule,
    TasksWorkerModule,
    WorkflowsModule,
    WorkflowsWorkerModule,
    HealthModule,
    OpenApiModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
