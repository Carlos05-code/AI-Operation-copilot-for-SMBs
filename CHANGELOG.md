# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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