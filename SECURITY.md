# Security Policy

We take the security of this product and its users seriously. Because this
platform handles business operations data — invoices, customer information,
inventory, communications — a security incident has a direct business impact.

## Reporting

**Do not** file a public issue. Please report suspected vulnerabilities
privately by emailing the maintainers at
`AI-Operation-copilot-for-SMBs@users.noreply.github.com`.

Please include:

- The affected component/module (e.g. `apps/backend`, `infrastructure/*`)
- Steps to reproduce (proof-of-concept strongly preferred)
- Affected capacity (versions/commit)
- Impact assessment

You will receive an acknowledgement within **7 business days** and a formal response
with the remediation plan, typically within a further.

## Supported versions

The project is under active development. Only the latest `main` and the latest
tagged release receive security fixes.

| Version                | Supported          |
| ---------------------- | ------------------ |
| `main` (rolling)       | ✅                 |
| latest release          | ✅                 |
| older releases          | ❌                 |

## Vulnerability disclosure headers

Provide the following when filing a report:

- Title — short and actionable
- Summary — what, in plain terms
- Impact — what an attacker could achieve
- Reproduction — step-by-step
- Affected versions/configs
- Suggested minimal / fix

## Security Principles

Reference: [Security Specification](docs/specifications/SECURITY_SPEC.md).

**Key obligations:**

- **No secrets in code or env files** — `*.env*` and `.env.local` are gitignored.
- **Least privilege** — service accounts and team members get only the minimal
  role required for a task.
- **Prompt injection defense** — all LLM inputs (user chat, documents, OCR output)
  are treated as untrusted data. Never per-organization data crossing tenant, and
  follows the containment policy described in the AI architecture.
- **Audit logging** — critical actions are logged and retained per the retention
  policy.
- **Sensitive data minimization** — PII and financial data never stored
  insecurely.

## Verification

Before any release:

- [ ] Dependency audit clean (`pnpm audit`, `npm audit`)
- [ ] SAST scan passes (Semgrep)
- [ ] Secrets scanned (gitleaks)
- [ ] Container images scanned (Trivy)
- [ ] OpenAPI diff reviewed

These checks are wired into our CI/CD pipeline workflows in
`.github/workflows/security-scan.yml`.