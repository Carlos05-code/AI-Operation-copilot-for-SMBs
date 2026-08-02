# Testing Specification

Status: **Draft · v0** · Owner: Carlos05-code

## 1. Test Pyramid

```
        E2E (few)
       /   \
     Integration
    (some)
      /
   Unit (many)
```

| Level            | Where              | Tooling                                 |
| ---------------- | ------------------ | --------------------------------------- |
| Unit (pure)      | domain/services    | Jest (TS), flutter_test (Dart)          |
| Integration      | DB/adapters        | Supertest + Jest, Prisma testcontainers |
| Widget (Flutter) | widgets            | flutter_test + widget_test              |
| E2E (API)        | `/tests`           | Supertest flows (Happy paths)           |
| E2E (Flutter)    | `integration_test` | integration_test package                |
| Load / PERF      | `/tests/load`      | k6                                      |
| Security         | `/tests/security`  | OWASP ZAP / Semgrep (see SECURITY)      |
| AI evaluation    | `tests/ai`         | pytest/test harness eval set            |

## 2. Unit Tests

- Pure domain logic without framework running.
- Use-cases tested against fake ports (never DB in unit tests).
- Coverage: 90% line (in `pnpm coverage`), statement coverage enforced in `jest.config`
  `coverageThreshold`.

## 3. Integration Tests

- Used for real adapter behavior (Prisma, Redis, MinIO, RabbitMQ).
- `testcontainers` spin ephemeral containers per test run — no shared mutable state.
- API integration flow: NestJS `supertest` against an app on ephemeral ports.

## 4. Widget Tests (Flutter)

- Wait for UI on golden/pixel tests for critical screens (set logic).
- `mocktail` for repositories; ProviderScope overrides.
- Golden files committed `test/goldens`; mismatch blocks.

## 5. E2E Tests

- API smoke on staging CI: auth → create org → invoice → search flow.
- Flutter `integration_test` against staged backend.

## 6. Performance / Load Tests (k6)

- `tests/load/*.ts` scenarios:
  - `smoke`: 5 users · 1 min
  - `soak`: 200 users · 30 min
  - `spike`: up to 1k users
- Assertions: p95 < 800ms, error % < 1%.
- k6 dashboards: three envs output `grafana` dashboard.

## 7. Security Tests

- Static: Semgrep + gitleaks on PR (github workflow).
- Dynamic: OWASP ZAP baseline in staging (nightly).
- Dependency: `pnpm audit` without failures gate on PR.
- API fuzzing targeted (persisted response schema contract).

## 8. Coverage Targets

| Layer        | Target                  |
| ------------ | ----------------------- |
| Backend core | ≥ 90%                   |
| Flutter      | ≥ 85%                   |
| AI eval set  | 100% pass (per release) |

## 9. CI Testing Pipeline

```mermaid
flowchart LR
    PR --> LINT[Lint + format]
    PR --> TSC[Typecheck]
    PR --> UT[Unit tests]
    PR --> INT[Integration Subset]
    PR --> DOC[Doc check]
    main --> E2E[Full E2E on staging]
    tag.v --> LOAD[k6 soak]
    tag.v --> SEC[Security scan]
    LOAD --> RELEASE
    SEC --> RELEASE
```

## 10. Reporting

- Coverage reports published to `coverage/` (html) + PR comment.
- k6 results stored as JSON for regression trend in `tests/load/results/`.
- API conformance snapshots (OpenAPI) under `docs/api/openapi.yaml`.
- All artifacts downloadable from CI summary.

## 11. Definition of "Test Completed"

A feature is only shipped when unit + integration + (if applicable) the capability E2E passes
locally AND in CI on the PR head, and performance targets are within monitored budget.

## 12. References

- [BACKEND_SPEC test section](./BACKEND_SPEC.md)
- [TESTING guide in CONTRIBUTING](../../CONTRIBUTING.md)
