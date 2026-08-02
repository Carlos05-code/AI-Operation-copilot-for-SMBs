<p align="center">
  <br/>
  <img src="screenshots/logo.png" alt="AI Operations Copilot" width="160"/>
  <br/>
  <h1 align="center">AI Operations Copilot for SMBs</h1>
  <p align="center">
    A virtual operations manager for small and medium businesses.
    Centralize WhatsApp, Email, Excel, invoices, inventory, calendars, and CRM into one intelligent, AI-powered operations hub.
  </p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="ROADMAP.md"><img src="https://img.shields.io/badge/status-foundation-%2309b3a5" alt="Status"></a>
  <a href="docs/specifications/ARCHITECTURE_SPEC.md"><img src="https://img.shields.io/badge/docs-architecture-orange" alt="Architecture docs"></a>
</p>

---

English | [Coming soon](docs/i18n/zh_TW.md)

---

## Project Overview

Small businesses waste hours every day switching between WhatsApp, Email, Excel spreadsheets,
invoices, calendars, inventory trackers, CRMs, and accounting software. Information is stranded
across disconnected tools, decisions are made on stale data, and operational follow-up falls
through the cracks.

**AI Operations Copilot** is an AI-powered operations hub that centralizes business operations into
a single intelligent platform capable of:

- Automating workflows (invoices, schedules, notifications, task planning)
- Assisting decision-making (sales forecasting, purchase recommendations, executive insights)
- Improving operational efficiency (document search, knowledge assistant, conversation summaries)
- Connecting organizational knowledge into a graph-based, semantically searchable knowledge base

It functions as a **virtual operations manager** that watches your data feeds, answers questions,
plans the day, and executes routine back-office work on your behalf.

## Architecture Overview

The system is a polyglot, event-driven, monorepo platform:

```mermaid
flowchart LR
    subgraph Clients
        App[Flutter App](#)
        Web[Dashboard UI](#)
    end
    subgraph Edge
        API[NestJS API Gateway](#)
        Keycloak[Identity Provider](#)
    end
    subgraph Data
        PG[(PostgreSQL - Operational)](db)
        Neo4j[(Knowledge Graph)](db)
        Qdrant[(Vector Database)]
        OpenSearch[(Full-text Search)]
        Minio[(Object Storage)]
        Redis[(Cache + Queue)]
    end
    subgraph AI
        LangGraph[AI Orchestration]
        LLM[Model Gateway OpenAI/Anthropic/Gemini]
        OCR[PaddleOCR / Tesseract]
    end
    subgraph Events
        RMQ[(RabbitMQ)]
        BullMQ[Workers]
    end
    App --> API
    Web --> API
    API --> PG
    API --> Neo4j
    API --> Qdrant
    API --> OpenSearch
    API --> Minio
    API --> Keycloak
    API --> LangGraph
    LangGraph --> LLM
    LangGraph --> Qdrant
    LangGraph --> Neo4j
    API --> RMQ
    RMQ --> BullMQ
    BullMQ --> Minio
```

See the full [System Architecture](/docs/diagrams/system-architecture.md).

## Technology Stack

| Layer          | Technology                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Frontend       | Flutter, Riverpod, GoRouter, Dio, Freezed, json_serializable                                       |
| Backend        | NestJS, TypeScript, Prisma ORM                                                                     |
| Databases      | PostgreSQL, Neo4j, Qdrant, Redis, OpenSearch                                                      |
| Storage        | MinIO (S3-compatible)                                                                              |
| Messaging      | RabbitMQ, BullMQ                                                                                   |
| Authentication | Keycloak, JWT, OAuth2, OpenID Connect                                                              |
| AI             | LangGraph, LangChain, OpenAI, Anthropic, Gemini, BAAI BGE-M3 embeddings                            |
| DevOps         | Docker, Kubernetes, GitHub Actions, NGINX                                                          |
| Observability  | Prometheus, Grafana, Loki, OpenTelemetry                                                           |
| Quality        | Jest, Supertest, Flutter Test, Integration Test, ESLint, Prettier, commitlint, lint-staged, k6     |

## Repository Structure

```text
.
├── apps/                    # Application entry points
│   ├── mobile/              # Flutter app (Android / iOS / Web / Desktop)
│   └── backend/             # NestJS API gateway + services
├── packages/               # Shared private packages
│   ├── shared/             # Cross-app TS contracts, types, DTOs
│   ├── ui/                 # Design system (tokens, components)
│   └── config/             # Runtime configuration + env schemas
├── docs/                   # Engineering documentation
│   ├── architecture/       # ADRs + architectural guides
│   ├── api/                # REST/OpenAPI documentation
│   ├── diagrams/           # Mermaid diagrams
│   ├── devops/             # Deployment, scaling, observability
│   ├── security/           # Security engineering
│   ├── specifications/     # System-wide specifications
│   └── testing/            # Testing strategy & reports
├── infrastructure/         # IaC & runtime infrastructure
│   ├── docker/             # Containerization
│   ├── kubernetes/         # Helm/K8s manifests
│   └── monitoring/         # Prometheus, Grafana, Loki
├── scripts/                # Automation utilities
├── assets/                 # Static assets
├── screenshots/            # Screenshots for README/docs
└── tests/                  # End-to-end & load tests
```

## Getting Started

### Prerequisites

- Node.js ≥ 20 (LTS)
- pnpm ≥ 9
- Flutter ≥ 3.24
- Docker Engine + Docker Compose
- Make (optional, for the `Makefile` helper targets)

### Quick start

```bash
# 1. Install platform dependencies
make setup

# 2. Start local infrastructure (PostgreSQL, Redis, etc.)
make infra-up

# 3. Initialize the database schema
make db-migrate

# 4. Start the backend
make backend-dev

# 5. Start the mobile app
make mobile-dev
```

> Consult [docs/devops/getting-started.md](docs/devops/getting-started.md) for platform-specific
> instructions and [docs/architecture/adrs](docs/architecture/adrs) for the rationale behind
> technology decisions.

## Development Workflow

1. Create a branch from `main`: `git checkout -b feat/your-feature`
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the Conventional Commits spec
3. Write/update documentation as part of your change (documentation-first)
4. Ensure `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass
5. Open a Pull Request — CI runs lint, build, tests, security scans automatically

## Documentation

- [Project Specification](docs/specifications/PROJECT_SPEC.md)
- [Architecture Specification](docs/specifications/ARCHITECTURE_SPEC.md)
- [Database Specification](docs/specifications/DATABASE_SPEC.md)
- [AI Architecture](docs/specifications/AI_ARCHITECTURE.md)
- [API Specification](docs/specifications/API_SPEC.md)
- [Frontend Specification](docs/specifications/FRONTEND_SPEC.md)
- [Backend Specification](docs/specifications/BACKEND_SPEC.md)
- [Security Specification](docs/specifications/SECURITY_SPEC.md)
- [DevOps Specification](docs/specifications/DEVOPS_SPEC.md)
- [Testing Specification](docs/specifications/TESTING_SPEC.md)
- [Design System](docs/specifications/DESIGN_SYSTEM.md)
- [Coding Standard](docs/specifications/CODING_STANDARD.md)
- [ADR Index](docs/architecture/adrs/README.md)

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the phased delivery plan and [CHANGELOG.md](CHANGELOG.md) for
release history.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md) before starting. Open questions? Use the appropriate
[issue template](.github/ISSUE_TEMPLATE/) — bug reports, feature requests, documentation requests,
and questions.

## License

Distributed under the Apache License 2.0. See [LICENSE](LICENSE) for more information.