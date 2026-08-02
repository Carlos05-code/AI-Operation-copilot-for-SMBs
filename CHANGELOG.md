# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository foundation (Phase 1):
  - Monorepo structure with Turborepo + pnpm workspaces
  - Flutter mobile app scaffold location (`apps/mobile`)
  - NestJS backend scaffold location (`apps/backend`)
  - Shared packages (`packages/shared`, `packages/ui`, `packages/config`)
  - Complete engineering documentation suite under `docs/`
  - Architecture Decision Records (ADR-0001 .. ADR-0013)
  - GitHub issue templates and CI/CD workflows
  - Infrastructure baseline (Docker Compose, Kubernetes, monitoring)
  - Design system specification and coding standards
- Backend API foundation (`@smb-copilot/backend` v0.1.0):
  - NestJS 10 application with URI versioning (`/api/v1/*`) and global validation pipe
  - Success envelope interceptor (`{ data, meta: { requestId, statusCode } }`, API_SPEC §2.1)
  - Unified error contract (`ApiError`, status→code mapping, global exception filter, API_SPEC §9)
  - Request correlation: `X-Request-Id` middleware + AsyncLocalStorage context
  - Pino structured logging with request id binding and secret redaction
  - Health module: readiness (`GET /api/v1/health`) and liveness (`GET /api/v1/health/live`)
  - OpenAPI 3.1 document at `GET /api/v1/openapi.json` (generated from decorators, API_SPEC §10)
  - Environment config validation (class-validator on `process.env`)

### Changed

- Design system promoted from Draft to Ratified (`docs/specifications/DESIGN_SYSTEM.md`)
- Design tokens are now AA-verified and enforced by a CI contrast gate

## [0.1.0] - 2026-08-02

### Added

- Design system foundation (`packages/ui`):
  - TypeScript token source of truth (colors, typography, spacing, radii, elevation, motion,
    breakpoints) with JSDoc
  - WCAG 2.1 contrast utilities and a CI contrast gate (fails under AA)
  - Platform generators producing `generated/tokens.css`, `generated/tokens.dart` (Flutter), and
    `generated/tokens.json`
  - Unit tests (node:test) for token integrity, 4px grid, radii, and contrast
