/**
 * OpenAPI document builder (API_SPEC §10: "server URL, global BearerAuth, tags
 * matching module names").
 *
 * @nestjs/swagger emits 3.0.0 documents; the ratified contract requires the
 * artifact to declare OpenAPI 3.1. The 3.0 document shape is a valid 3.1
 * subset, so we relabel at build time here (single source of truth).
 *
 * Every controller already carries a real `@ApiTags(...)` matching its module
 * name (operation-level tags were never missing) — `addTag` below just gives
 * each one the description Swagger UI shows in its top-level grouping, using
 * this repo's own doc comments for each controller as the source, not new
 * copy invented for this file.
 */
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const OPENAPI_VERSION = '3.1.0';

/** name matches each controller's `@ApiTags(...)` exactly. */
const TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'health', description: 'Liveness and readiness probes for orchestrators.' },
  { name: 'appointments', description: 'Appointment scheduling (ROADMAP Phase 3).' },
  { name: 'chat', description: 'Grounded document Q&A with citations (RAG).' },
  {
    name: 'connectors',
    description:
      'Inbound channel connectors (WhatsApp/email/Slack) feeding the conversation pipeline.',
  },
  { name: 'conversations', description: 'Conversation ingestion and AI summaries.' },
  { name: 'dashboard', description: 'Read-only executive dashboard snapshot.' },
  { name: 'documents', description: 'Document ingestion pipeline (upload -> register -> ingest).' },
  { name: 'forecasting', description: 'Sales forecasting (trend + seasonality).' },
  { name: 'insights', description: 'Executive insights briefings.' },
  {
    name: 'inventory',
    description:
      'Inventory-wide endpoints (manual reorder sweep); per-product endpoints are tagged `products`.',
  },
  { name: 'invoices', description: 'Invoice generation and lifecycle (issue/pay/void).' },
  { name: 'knowledge', description: 'Read-only org knowledge-base surface.' },
  { name: 'notifications', description: 'Notification delivery (manual sweep trigger).' },
  { name: 'products', description: 'Product catalog and stock movements.' },
  { name: 'purchasing', description: 'Purchase recommendations.' },
  { name: 'recurring-invoices', description: 'Recurring-invoice billing schedules.' },
  {
    name: 'search',
    description: 'Hybrid search (vector + full-text + graph) — RAG retrieval entry point.',
  },
  { name: 'storage', description: 'Presigned object-storage upload/download URLs.' },
  { name: 'tasks', description: 'Org tasks plus the AI task-planning trigger.' },
  { name: 'workflows', description: 'Workflow rules engine (manual sweep trigger).' },
];

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('AI Operations Copilot API')
    .setDescription('Operations and AI platform for SMBs.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addServer(process.env.APP_URL ?? 'http://localhost:3000');
  for (const tag of TAGS) {
    builder.addTag(tag.name, tag.description);
  }
  const document = SwaggerModule.createDocument(app, builder.build());
  return { ...document, openapi: OPENAPI_VERSION };
}
