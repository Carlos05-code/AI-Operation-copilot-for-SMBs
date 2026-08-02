# Authentication Flow

OIDC Authorization Code + PKCE through Keycloak.

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client (Flutter)
    participant KC as Keycloak
    participant API as API Gateway

    U->>C: Open app / login
    C->>KC: GET /auth (PKCE code_challenge)
    KC-->>U: Login page
    U->>KC: Credentials (+ MFA if configured)
    KC-->>C: Authorization code redirect
    C->>KC: POST /token (code + verifier)
    KC-->>C: access_token (JWT) + refresh_token
    C->>API: GET /v1/me  (Bearer JWT)
    API->>KC: Verify JWT via JWKS (iss/aud/exp/roles)
    API-->>C: 200 + user + org scopes
```

- Access token TTL: 15 min; refresh rotation (7 days).
- Refresh on 401 handled by Dio interceptor.
- Role claims (`org_id`, `org.role`) populate tenant context.

## Also see

- [SECURITY_SPEC](../specifications/SECURITY_SPEC.md)
- [Keycloak ADR](../architecture/adrs/ADR-0008-keycloak.md)
