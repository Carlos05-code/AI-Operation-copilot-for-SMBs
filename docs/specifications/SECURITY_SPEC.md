# Security Specification

Status: **Draft · v0** · Owner: Carlos05-code

## 1. Security Principles

- **Defense in depth** — every layer has its own control; no single guard carries all the trust.
- **Least privilege** — RBAC scopes + short-lived tokens + no over-scoped service accounts.
- **Secure by default** — TLS everywhere, encrypted at rest, tenant isolation asserted by default.
- **Data minimization** — store only what’s needed; PII expiry and export enabled.
- **Zero trust on AI data** — instructions inside documents/OCR/chat are treated as _untrusted
  content_.

## 2. OWASP Top 10 Mitigations

| #   | Risk                        | Mitigation                                                            |
| --- | --------------------------- | --------------------------------------------------------------------- |
| A01 | Broken Access Control       | RBAC, tenancy `org_id` always on queries, deny-by-default guards      |
| A02 | Cryptographic Failures      | TLS 1.2+, AES-256 at rest, argon2/bcrypt only where hashing is needed |
| A03 | Injection                   | Parameterized SQL via Prisma; no raw query building from user input   |
| A04 | Insecure Design             | Threat modeling template, security reviews in CI checklist            |
| A05 | Security Misconfiguration   | Immutable config per env; validation gates; default deny policies     |
| A06 | Vulnerable Components       | Renovate/ Dependabot on GH Actions; `pnpm audit` gate                 |
| A07 | Authentication Failures     | Keycloak-managed sessions, short access, refresh rotation, MFA-ready  |
| A08 | Software & Data Integrity   | Signed releases, checksummed container images, provenance             |
| A09 | Security Logging & Monitors | Audit log + trace log + alerts; correlation id                        |
| A10 | SSRF / Request Forgery      | Outbound URL allow-list; no raw redirects to user-supplied filenames  |

## 3. Authentication (JWT / OAuth2 / OIDC)

- Keycloak is the IdP; the client uses **Authorization Code flow (+ PKCE)**.
- Access token JWT (`RS256` from Keycloak JWKS) — validated `iss`, `aud`, `exp`, `nbf`, `azp`/`sid`;
  `org_id` and `org.role` claims drive RBAC.
- Refresh tokens rotated on use, HTTP-only cookie transport in web; secure storage in apps.
- Row-level tenancy: server-side lookup of `org_id` from the token claims; mutating endpoints assert
  `member.role` ≥ required.

## 4. RBAC Model

| Role      | Scope          | Representative permissions                    |
| --------- | -------------- | --------------------------------------------- |
| `owner`   | whole org      | all, billing, invites, integrations           |
| `admin`   | whole org      | all except billing                            |
| `manager` | assigned teams | CRUD operational entities; approve AI actions |
| `agent`   | assigned scope | read/write assigned entities; chat            |
| `viewer`  | read-only      | dashboards, documents read                    |

Enforcement: Nest guard (`RolesGuard`) + `TenancyGuard` at route level; entity-level checks in
application services.

## 5. Secrets Management

- Prod: Kubernetes Secrets + SealedSecrets Vault (path per env) at pods.
  - Local/K8s containers: `configs/.env` referenced, ignored in git.
- Never commit `.env` / keys; `.env.example` is the only template committed.
- Rotation policy: high-privilege secrets rotate ≤ 90 days.

## 6. Audit Logs

- Actions: auth events, RBAC changes, data exports, payment/invoice, document deletes, AI execution.
- Payload: `actor, action, resource, ts, ip, org_id, result`.
- Retention: ≥ 400 days (stage), longer for invoicing where required.
- Stored in `audit_logs` (PostgreSQL) + shipped to OpenSearch for analysis.

## 7. Encryption

- At rest: Volume encryption (cloud-default) for PostgreSQL, S3/SSE for MinIO, encrypted Cosmos;
  Redis follows suite.
- In transit: TLS everywhere; DB TLS required; internal mesh MTLS where supported.
- Application-level: PII/secret columns encrypted at app layer when mandated (e.g., customer tax IDs
  via envelope key).
- At-rest backup encryption with unique keys.

## 8. Prompt Injection Protection

1. Tag all ingested content as `<untrusted>` in prompt boundaries.
2. Never allow user/document content to define system-level instructions.
3. Detect & refuse direct/indirect injection attempts (rules + model guard).
4. Output validation schema to prevent tool-calling bypass.
5. Human-in-the-loop for high-impact actions (payments, deletions, external send).
6. Prompt template audit in CI (AI). See [AI_ARCHITECTURE](./AI_ARCHITECTURE.md).

## 9. Input Validation & File Uploads

- All inputs validated (`validation` in API_SPEC).
- CSV/XLS parsed with strict schema; embedded formulas ignored.
- Uploads:
  - `Content-Type` + magic-bytes sniffing.
  - size limit `MAX_UPLOAD_SIZE_MB`, scan anti-Virus in transport (isolated).
  - filename sanitized; stored as opaque object keys in MinIO.
  - HTML/JS content never rendered.

## 10. File Upload Security (document pipeline)

- Opaque keys, no client-controlled paths.
- Images: re-encode to normalized format (strip exif).
- OCR text treated as untrusted content (see §8).

## 11. Privacy

- Purpose limited: data collected for operations only.
- Data retention per region; automatic deletion of personal data upon request/account.
- Export API (`GET /v1/org/export`) produces a full dataset bundle.
- GDPR: right to access/rectify/port/delete routed via support workflows.

## 12. Compliance Considerations

- Alignment effort: SOC 2 Type I/II (later), GDPR (early), PCI (payment via stripe-like service, not
  stored in-house).
- Deletion contracts for LLM provider embeddings when customer data used (BYOK).
- Privacy policy, Terms of Service, Data Processing Agreement artifacts in `docs/` (lawyer review
  before legal use).

## 13. Security Testing

| Type              | Tool                          | Cadence                     |
| ----------------- | ----------------------------- | --------------------------- |
| SAST              | Semgrep                       | on PR (`security-scan.yml`) |
| Secret scanning   | gitleaks                      | on PR                       |
| Dependency        | `pnpm audit` + `npm audit`    | on PR & daily               |
| Image             | Trivy                         | on release                  |
| DAST              | scheduled OWASP ZAP (staging) | weekly                      |
| Dependency review | GitHub+Dependabot             | on PR per manifest change   |

## 14. Roles & Responsibilities

- AppSec owner reviews security-relevant PRs (CODEOWNERS `/docs/security/`).
- Blast radius discipline: DB credentials never shared with FR; one service credential per purpose.
- Every PR touches security-sensitive paths → review by a qualified reviewer.

## 15. Related

- [Incident response](../devops/oncall.md)
- [Authentication flow diagram](../diagrams/authentication-flow.md)
- [AI guardrails](./AI_ARCHITECTURE.md)
