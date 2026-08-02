# ADR-0003: NestJS backend framework

- Status: Accepted
- Date: 2026-08-02
- Owner: I-Dev
- Deciders: Backend Team

## Context

The backend must serve a multi-tenant operations + AI platform: many modules (auth, org, customers,
inventory, sales, invoices, documents, AI, search, notifications), heavy async event processing, and
observability. Options: NestJS, Express/Fastify, tRPC, Go (Gin), Spring (Java).

## Decision

Build the backend with **NestJS** (TypeScript), structured as a **modular monolith** with strict
module boundaries.

- TypeScript for end-to-end typing with the Dart side via OpenAPI.
- Modules, dependency injection, HTTP + message-processing built-in.
- REST API; OpenAPI generated from decorators.
- Modular monolith: services initially in one deployable; split later if needed.

## Alternatives

| Option          | Trade-off                                                     |
| --------------- | ------------------------------------------------------------- |
| Express/Fastify | Minimal; you assemble everything yourself; less opinionated   |
| tRPC            | Great DX but locks clients to TS; not ideal for Dart/OAuth UI |
| Go services     | Fast, but slower delivery + no DI/tooling as mature           |
| Spring Boot     | Heavy, JVM ops burden for the delivery size                   |

## Pros

- Strong conventions (modules, DI, guards, pipes) already match our architecture.
- TypeScript shares contracts defined once.
- Rich ecosystem (BullMQ, Prisma, OTel, swagger) integrate well.

## Cons

- NestJS adds abstraction overhead vs raw Express.
- Requires discipline to keep modular monolith boundaries.

## Consequences

- `apps/backend` = single NestJS app with per-feature modules.
- Cross-module communication via events/internal API only (ARCHITECTURE_SPEC).
- OpenAPI served at `/api/v1/openapi.json`; contract-first for clients.

## References

- [BACKEND_SPEC](../specifications/BACKEND_SPEC.md)
- [ARCHITECTURE_SPEC](../specifications/ARCHITECTURE_SPEC.md)
