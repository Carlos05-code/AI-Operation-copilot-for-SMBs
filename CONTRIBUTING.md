# Contributing

First off, thank you for considering contributing to the **AI Operations Copilot for SMBs**. We
value contributions from everyone, whether you are fixing a typo, adding a feature, improving the
AI/operations pipelines, or increasing test coverage.

Please take a moment to review this document and our [Code of Conduct](CODE_OF_CONDUCT.md) before
you get started.

## Table of Contents

1. [Ways to Contribute](#ways-to-contribute)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Branch Strategy](#branch-strategy)
5. [Commit Convention](#commit-convention)
6. [Pull Request Process](#pull-request-process)
7. [Code Review Checklist](#code-review-checklist)
8. [Definition of Done](#definition-of-done)
9. [Reporting Bugs & Suggesting Features](#reporting-bugs--suggesting-features)

## Ways to Contribute

- Reporting bugs
- Suggesting enhancements or new workflows
- Adding or improving documentation (documentation-first!)
- Writing or fixing tests
- Contributing code (Flutter, NestJS, infrastructure, AI pipelines)
- Reviewing pull requests

## Getting Started

Fork the repository and clone your fork:

```bash
git clone https://github.com/Carlos05-code/AI-Operation-copilot-for-SMBs.git
cd AI-Operation-copilot-for-SMBs
```

Install dependencies with pnpm:

```bash
pnpm install
```

## Development Setup

The repository is documentation-first. If you touch a subsystem, update its specifications,
diagrams, and ADRs in `docs/` alongside your code change in the **same pull request**.

Confirm your change works:

```bash
pnpm lint          # ESLint + Prettier
pnpm typecheck     # TypeScript type checks
pnpm test          # Unit tests
pnpm docs:check    # Validate markdown links and internal references
```

## Branch Strategy

We follow **GitHub Flow**:

- `main` is always releasable.
- Work in short-lived feature branches.
- Every branch must be created from the latest `main`.

Standard branch naming:

| Prefix      | Purpose                    |
| ----------- | -------------------------- |
| `feat/`     | New feature or enhancement |
| `fix/`      | Bug fix                    |
| `docs/`     | Documentation              |
| `chore/`    | Housekeeping               |
| `refactor/` | Refactoring                |
| `perf/`     | Performance work           |
| `test/`     | Test-only changes          |
| `security/` | Security fix               |
| `release/`  | Release preparation        |

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/). Commits failing the `commitlint`
rules are rejected by the git hook.

```
<type>(<scope>): <short summary>

<body>

<footer>
```

Examples:

```
feat(invoice): generate PDF invoice from order payload

fix(auth): refresh token rotation on 401

docs(architecture): add ADR-0014 for hybrid search
```

Commit types supported: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`, `security`.

## Pull Request Process

1. Keep PRs small and focused; one concern per PR.
2. Title your PR with the Conventional Commit prefix, e.g. `feat(mobile): revenue chart`.
3. Describe **what** and **why**; reference related issues (e.g. `Closes #42`).
4. Run the pre-push script (`pnpm run pre-push`) locally.
5. CI runs lint, typecheck, unit tests, build, Markdown lint, and security/ dependency scans.
6. PRs require at least one approving review from a team member before merge.
7. Use **squash-and-merge**; the final commit message must be a valid Conventional Commit.

## Code Review Checklist

- Design/solution is correct and justified
- No new security risks (prompt injection, SQL injection, XSS, injection in OCR content)
- No secrets in code or env files (`.env*` are gitignored)
- Errors are handled and logged consistently
- Tests cover new logic; coverage entry and exit thresholds respected
- Documentation and ADRs are up to date
- No dead code, no TODO/FIXME comments, no placeholder implementations
- Formatting and lint pass

## Definition of Done

A task is **done** when:

1. The feature is implemented fully (not a stub).
2. Lint + format pass.
3. Typecheck passes.
4. All new tests are added and existing tests are green.
5. Documentation (docs, ADRs, API contract) is updated in the same PR.
6. Security review completed if surface area was touched.
7. Performance review completed when hot paths are touched.
8. No TODO/FIXME or placeholder implementation remains.

## Reporting Bugs & Suggesting Features

Use the appropriate template under `.github/ISSUE_TEMPLATE/`:

- Bug Report → label `bug`
- Feature Request → label `enhancement`
- Documentation Request → label `documentation`
- Question → label `question`

Security vulnerabilities should **not** be filed as public issues. Please review
[SECURITY.md](SECURITY.md) and report privately.
