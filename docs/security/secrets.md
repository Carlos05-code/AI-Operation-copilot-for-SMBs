# Secrets Management

## Principles

- No secrets in code, compose files, or images.
- `.env*` is gitignored (see `.gitignore`); `.env.example` is committed.
- Production secrets live in Kubernetes Secrets (SealedSecrets) or a Vault,
  injected as env vars at deploy time.

## Dev

- Local secrets: untracked `.env` at repo root (copy `.env.example`).
- Never commit or share `.env`.

## Prod

| Store | Mechanism |
| ----- | --------- |
| Kubernetes | opaque `Secret` objects; SealedSecrets for GitOps |
| Vault (optional) | dynamic DB credentials, tokens, rotated |
| Cloud | managed KMS-wrapped database key (SSE-KMS) |

## Rotation

- Secrets rotate on suspicion or on schedule (high-privilege ≤ 90 days).
- Rotation procedures documented by secret owner; secrets are per-scope.

## Related

- [SECURITY_SPEC](../specifications/SECURITY_SPEC.md)