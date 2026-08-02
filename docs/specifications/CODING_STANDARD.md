# Coding Standard

Status: **Ratified** · Owner: Carlos05-code

Applies to all code in `apps/*` and `packages/*`. Any change is blocked if it violates these rules.

## 1. Naming

| Kind              | Style                               | Example                    |
| ----------------- | ----------------------------------- | -------------------------- |
| Files             | kebab-case                          | `create-invoice.dto.ts`    |
| Classes/IDs       | PascalCase                          | `CreateInvoiceDto`         |
| Functions/methods | camelCase                           | `createInvoice()`          |
| Constants         | SCREAMING_SNAKE                     | `MAX_UPLOAD_SIZE_MB`       |
| Env vars          | SCREAMING_SNAKE                     | `DATABASE_URL`             |
| Flutter (Dart)    | folders lowercase; types PascalCase | `features/`, `InvoiceCard` |
| DB columns        | snake_case                          | `due_date`                 |

## 2. Folder structure

- Feature-first:
  `apps/backend/src/modules/<feature>/{domain,application,infrastructure,presentation}`.
- Flutter: `apps/mobile/lib/features/<feature>/{data,domain,presentation}`.
- No deep folder noise: at most 3 levels beneath `modules` / `features`.

## 3. Architecture rules

- Domain never imports framework/ORM/transport.
- Application depends only on ports + domain.
- Cross-feature calls go through events or application API, never deep internals.
- Single responsibility per class; entities carry no persistence concerns.

## 4. SOLID

- S: single purpose per class/module (large files split).
- O: open for extension via ports/policies, closed for modification.
- L: subclass forms use-cases via composition, not subclasses misleading others.
- I: interfaces small and cohesive.
- D: high layers depend on abstractions (see dependency rules).

## 5. DRY & KISS

- Extract shared logic into `shared/` or a `packages/` lib when used in 2+ places.
- Prefer the simplest correct solution; no speculative generality.
- Avoid cleverness; bias for readability.

## 6. Documentation rules

- Public symbols get JSDoc: _purpose_, _params/returns/raises_, _example_ when non-obvious.
- Architecture changes ALWAYS update an ADR + the affected doc, same PR.
- Readmes required for each new package.

## 7. Logging rules

- Structured `logger.info/error/warn` (Pino); no `console.log` in routes.
- Bind context: `orgId`, `userId`, `requestId`, `tenant`.
- Log at levels honestly: info await-flow, warn for degraded, error only for failures.

## 8. Error handling

- Throw typed exceptions in domain; map at edge (single exception filter).
- Never swallow errors without commit /retry semantics or observation.
- External calls always wrapped with retry/backoff policy; partial failures modelled.

## 9. Git workflow

- Conventional Commits enforced by commitlint (husky).
- Semver-declared releases via CHANGELOG.
- One commit = one logical change (rebase/squash in review).

## 10. Branch strategy

- GitHub Flow: branch from `main`; `feat/`, `fix/`, `docs/`, `chore/`, `perf/`, `release/` prefixes.
- Short-lived branches (< 1 week); PR review required.

## 11. Code review checklist (be completed before merging)

- [ ] Change matches issue/scope
- [ ] Tests added/updated for new logic
- [ ] Edge cases covered (empty results, race, deletions)
- [ ] No security regressions (see [SECURITY_SPEC](./SECURITY_SPEC.md))
- [ ] No secrets or PII logged
- [ ] Docs/ADR updated where relevant
- [ ] Performance considered on hot paths
- [ ] No dead/leftover code, no debug logs

## 12. Definition of Done

1. Implementation complete (no stubs/TODOs).
2. Format + lint pass locally and CI.
3. Typecheck passes.
4. All tests green; new code ≥ 90% coverage threshold.
5. Docs updated in same PR.
6. Security review completed (if surface area).
7. Reviewed + approved by >= 1 maintainer.
8. Conventional Commit message describes change.

## 13. Tooling

- Lint: ESLint, Prettier; Flutter: `flutter analyze`.
- Commit hooks: Husky (lint-staged + commitlint).
- CI gates: see [DEVOPS_SPEC](./DEVOPS_SPEC.md) & `.github/workflows/`.
