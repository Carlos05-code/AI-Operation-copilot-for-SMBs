# Mobile Application

> Location for the **Flutter** client. Feature-first, Riverpod, adaptive UI.

This directory is intentionally empty — see the
[Frontend Specification](../../docs/specifications/FRONTEND_SPEC.md) and
[ADR-0002: Flutter for the SMB client](../../docs/architecture/adrs/ADR-0002-flutter.md) for the
target structure.

Planned layout:

```
apps/mobile/lib/
├── app/                     # composition root; router; theme wiring
├── features/
│   └── <feature>/
│       ├── data/            # repositories, datasources (Dio)
│       ├── domain/          # entities + use-cases (freezed)
│       └── presentation/    # riverpod controllers, pages, widgets
├── shared/                  # design tokens, i18n, common widgets
└── l10n/
```

The single codebase targets **mobile, web, and desktop** out of one source.
