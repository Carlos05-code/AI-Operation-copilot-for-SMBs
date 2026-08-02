# CI/CD Pipeline

```mermaid
flowchart LR
    PUSH[Push to main / PR] --> TR[Triggers: lint, type, tests, docs]
    TR --> L[Lint + Prettier]
    TR --> TY[Typecheck]
    TR --> UT[Unit tests]
    TR --> DOC[Markdown + link check]
    TR --> INT[Integration subset]
    TR --> SEC[Security scans]
    main --> E2E[E2E staging]
    TAG[tag v*] --> MI[Build + push images]
    MI --> MG[Migrations deploy]
    MG --> DP[Deploy staging]
    DP --> SMOKE[Smoke tests]
    SMOKE --> CANARY[Canary 5% prod]
    CANARY --> FULL[Roll to 100%]
    FULL --> NOTES[Changelog + release]
```

## Workflow → purpose

| File | Purpose |
| ---- | ------- |
| `.github/workflows/lint.yml` | ESLint, Prettier, commitlint |
| `.github/workflows/build.yml` | Backend & Flutter build matrix |
| `.github/workflows/docs.yml` | Markdown lint + link validator + Mermaid syntax check |
| `.github/workflows/security-scan.yml` | Semgrep, gitleaks, dep audit, Trivy |
| `.github/workflows/release.yml` | Tag-driven build + migration + deploy + notes |

## Read more

- [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md)