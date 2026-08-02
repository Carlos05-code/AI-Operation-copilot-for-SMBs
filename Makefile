SHELL := /bin/bash

#---------- Project -------------------------------------------------
PROJECT := ai-operation-copilot

#---------- Infra ----------------------------------------------------------
.PHONY: setup infra-up infra-down infra-logs db-migrate db-seed

setup: ## Install tooling + JS dependencies
	@echo '>> Installing dependencies'
	pnpm install

infra-up: ## Start local infrastructure (Docker Compose)
	docker compose up -d

infra-down: ## Stop local infrastructure
	docker compose down

infra-down-volumes: ## Stop + remove volumes
	docker compose down -v

infra-logs:
	docker compose logs -f

db-migrate: ## Apply database migrations
	cd apps/backend && pnpm prisma migrate deploy

db-seed: ## Seed the database
	cd apps/backend && pnpm prisma db seed

db-generate: ## Regenerate Prisma client
	cd apps/backend && pnpm prisma generate

#---------- Applications --------------------------------------------------------
.PHONY: api-dev api-build mobile-dev mobile-build

api-dev: ## Run the NestJS backend in watch mode
	cd apps/backend && pnpm dev

api-build:
	cd apps/backend && pnpm build

mobile-dev: ## Run the Flutter app
	cd apps/mobile && flutter run

mobile-build:
	cd apps/mobile && flutter build apk

#---------- Quality ------------------------------------------------------------------
.PHONY: lint format typecheck test test-e2e check

lint:
	pnpm lint

format:
	pnpm format

format-check:
	pnpm format:check

typecheck:
	pnpm typecheck

test:
	pnpm test

test-e2e:
	pnpm test:e2e

check: lint format-check typecheck test ## Full quality gate

#---------- Release ---------------------------------------------------------------------
.PHONY: release

release:
	@echo 'Releases are driven by GitHub Actions; see .github/workflows/release.yml.'

#---------- Help ---------------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'