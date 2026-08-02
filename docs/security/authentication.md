# Authentication & Authorization Flows

Companion to [SECURITY_SPEC](../specifications/SECURITY_SPEC.md).

## Trust boundaries

```mermaid
flowchart LR
    subgraph Client
        A[Flutter App]
    end
    subgraph Edge
        KC[Keycloak]
        API[API Gateway]
    end
    subgraph Data
        DB[(PostgreSQL)]
    end
    A -->|HTTPS TLS| API
    A -->|OIDC| KC
    KC --> API
    API --> DB
```

## JWT validation

- Algorithm: RS256 (Keycloak JWKS).
- Checks: signature, `iss`, `aud`, `exp`, `nbf`, and claims `org_id`, `role`.
- Token refresh: on `401`, refresh via `/auth/refresh`; retry once.

## Tenancy

- `org_id` claim drives all database queries (row-level + app-layer checks).
- No cross-org data reachable without RBAC role.

## Also see

- [SECURITY_SPEC](../specifications/SECURITY_SPEC.md)
- [authentication-flow diagram](../diagrams/authentication-flow.md)
