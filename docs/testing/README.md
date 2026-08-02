# Testing

Test strategy for the repository.

## Layers

| Type         | Where             | Command                               |
| ------------ | ----------------- | ------------------------------------- |
| Unit         | `apps/backend`    | `pnpm test`                           |
| Integration  | `apps/backend`    | `pnpm test:integration`               |
| E2E (API)    | `tests/e2e`       | `pnpm test:e2e`                       |
| Load         | `tests/load`      | `k6 run tests/load/smoke.ts`          |

## Coverage

Targets: backend ≥ 90%, Flutter ≥ 85%; coverage gates fail the build if under.
Reports in `coverage/`.

## Namespace

- All tests referenced in [TESTING_SPEC](../specifications/TESTING_SPEC.md).

## CI integration

- Every PR runs lint → typecheck → unit → integration → docs check.
- Tagged releases run e2e + k6 soak + security scans.