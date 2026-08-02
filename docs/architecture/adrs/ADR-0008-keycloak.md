# ADR-0008: Keycloak as identity provider

- Status: Accepted
- Date: 2026-08-02
- Owner: Security
- Deciders: Backend + Security

## Context

Authentication needs to handle OAuth2/OIDC SSO (WhatsApp Business, email IMAP, Google), JWT,
MFA-readiness, user federation, and RBAC claims. Options: Auth0 (SaaS), Okta, AWS Cognito, custom
auth, Keycloak.

## Decision

Use **Keycloak** as the centralized identity provider, the gateway for OIDC, JWT tokens and RBAC
roles.

- OIDC Authorization Code + PKCE for clients.
- JWT (`RS256`) access tokens with `org_id`/`role` claims for the API.
- Realms: one `smb-copilot` realm with roles for `owner/admin/manager/member`.
- MFA-ready, self-hosted (ADR-0009/0010).

## Alternatives

| Option      | Trade-off                                                       |
| ----------- | --------------------------------------------------------------- |
| Auth0/OKTA  | Great SaaS but recurring cost + data leaves infra & sovereignty |
| AWS Cognito | Locks to AWS; limits custom claims/integration richness         |
| Custom auth | High maintenance, security risk, reinvents wheels               |
| Supertokens | Nice, but fewer OIDC integration features                       |

## Pros

- Rich OIDC/OAuth out of box: codes, PKCE, refresh rotation, MFA, federation.
- Self-hosted = data control + no per-user SaaS fee.
- Wide tooling for client integrations.

## Cons

- Another service to run and patch.
- Custom realm/config per env needs IaC care.

## Consequences

- Client uses Authorization Code + PKCE; API validates JWKs via a guard.
- RBAC roles derive from Identity Provider claims; changes sync via events to the platform database.
- Keycloak runs in Docker Compose locally and in K8s in prod, with realm export/import as code.

## References

- [SECURITY_SPEC](../specifications/SECURITY_SPEC.md)
