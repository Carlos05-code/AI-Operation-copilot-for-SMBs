# API Documentation

This directory contains the API reference for the platform.

## Overview

- **Versioning**: `/api/v1`
- **OpenAPI JSON** (generated): `apps/backend` → `GET /api/v1/openapi.json`
- Snapshot per release is committed here as `openapi.yaml`.

## Standards

See the human-readable contract:

- [API Specification](../specifications/API_SPEC.md) — REST standards, versioning, pagination,
  filtering, sort, auth, errors.

## Endpoints Overview (v1)

| Area          | Prefix              | Summary                           |
| ------------- | ------------------- | --------------------------------- |
| Auth          | `/v1/auth/*`        | OIDC callback, session, mfa       |
| Organizations | `/v1/orgs`          | tenant CRUD, members, settings    |
| Customers     | `/v1/customers`     | customers + conversation linkages |
| Products      | `/v1/products`      | SKU, pricing, attributes          |
| Inventory     | `/v1/inventory`     | stock, movements, reorder alerts  |
| Sales         | `/v1/orders`        | orders + statuses                 |
| Invoices      | `/v1/invoices`      | CRUD, PDF, status events          |
| Documents     | `/v1/documents`     | upload, processing status         |
| Search        | `/v1/search`        | hybrid keyword + vector search    |
| AI            | `/v1/chat`          | streaming grounded chat           |
| Notifications | `/v1/notifications` | inbox, read/sent                  |
| Health        | `/v1/health`        | liveness + readiness checks       |

## Contracts

Each endpoint is defined in the OpenAPI document. Example shapes:

```json
// Error contract (all endpoints)
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request body failed validation.",
    "status": 422,
    "details": { "field": "customerId", "messages": ["must be a valid uuid"] },
    "path": "/api/v1/customers",
    "timestamp": "2026-08-02T10:00:00Z",
    "requestId": "e2f3..."
  }
}
```

- [OpenAPI snapshot](./openapi.yaml) <sup>generated at build</sup>
- [README docs](../specifications/API_SPEC.md)
