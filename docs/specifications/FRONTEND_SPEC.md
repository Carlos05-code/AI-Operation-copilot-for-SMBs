# Frontend Specification

> Flutter · feature-first · Riverpod · adaptive UI

## 1. Overview

The client is a single **Flutter** codebase targeting **mobile, web, and desktop**
out of one source. `apps/mobile` follows feature-first Clean Architecture with
Riverpod as the state-management substrate.

## 2. Feature-First structure

```
apps/mobile/lib/
├── app/                     # composition root; router; theme wiring
│   ├── router/              # GoRouter configuration
│   ├── preferences.dart     # shared app descriptors
│   └── bootstrap.dart
├── features/
│   └── <feature>/
│       ├── data/            # repositories, datasources (Dio)
│       ├── domain/          # entities + use-cases (freezed)
│       ├── presentation/    # riverpod controllers, pages, widgets
│       └── widgets/
├── shared/                  # design tokens, i18n, common widgets
└── l10n/
```

## 3. Routing (GoRouter)

- Central `RouterConfig` in `app/router`.
- State-driven navigation: redirects based on auth and sync state.
- Nested routes per shell (dashboard, ops, settings).
- Deep-linking for web; scheme registration for mobile (`app://customer/…`).

## 4. State Management (Riverpod)

- Watch consumers (`ConsumerWidget`, `ConsumerStatefulWidget`).
- Providers: `AutoDispose` by default; `ProviderScope` overrides in tests.
- Async providers (`AsyncNotifier` / `FutureProvider`) mirror `AsyncValue`.
  - `loading / data / error` handled in UI layer.
- Domain-layer repositories are the only places touching network/storage.
- Riverpod lint rules: `riverpod_lint` (ProviderScope with overrides in tests).

## 5. Theming

- Material 3 (`ColorScheme.fromSeed`), light + dark themes.
- Design tokens from `packages/ui` (colors, spacing, typography, radii).
- Typography scale via `TextTheme` extension; dynamic text scaling respected.
- Default light theme for SMBs (accessible, high contrast navy/teal, WCAG >= 4.5:1).

## 6. Localization (l10n)

- `flutter_localizations` + ARB files in `lib/l10n/`.
- Locales: `en`, `pt` (PT-BR), `es`. Fallback `en`.
- All user strings parametric; dates/numbers localized via `intl`.
- Accessibility string concatenation avoided (compositional).

## 7. Accessibility

- Target WCAG **AA**.
- Semantic labels for interactive elements; `Tooltip`/`Semantics` where needed.
- Focus traversal & keyboard shortcuts on desktop/web.
- Dynamic text scaling (no fixed heights on critical text).
- Color contrast check in CI (golden rendering with a checker).

## 8. Offline support

- Repository pattern: network-first with local cache fallback (Hive).
- Write queue: send mutations offline, retry when back (queued locally).
- Conflict: last-write-wins with server-side `updated_at` guard; conflict surfaced.
- Read-only cache of last-known-good data for offline browsing.

## 9. Caching

- Hive for feature data (per user, small), `flutter_secure_storage` for tokens.
- `SharedPreferences` reserved for lightweight prefs only.
- Freshness TTL per cache key via domain repos.

## 10. Animations & motion

- Motion philosophy: **functional, calm, FPS > 60 baseline, respect reduced motion**.
- Standard durations/curves defined in design tokens (`packages/ui` motion).
- Occupy simple hero/transition effects; page transitions via GoRouter.

## 11. Design tokens

- Canonical tokens live in `packages/ui` (exported for Flutter + web).
- Arrays: color steps, spacing scale (4px grid), radii, typography (type scale
  w/ weight), motion (durations/curves).

## 12. Responsive strategy

- Breakpoints: compact (<600), medium (600–1024), expanded (>1024).
- LayoutBuilder/ adaptive: master-detail (customer conversation, invoices),
  bottom nav on mobile → rail on desktop.
- Tested matrix: phones (portrait), tablets, desktop, web (Chrome).

## 13. Networking (Dio)

- Dio client factory in `core/network`:
  - interceptors: auth (Bearer), tenancy (`X-Org-Id`), logging, retry (with
    jitter), Idempotency-Key for mutations.
  - error mapping to typed exceptions (`ApiException(code,message)`).
- Testing: `mocktail` + `mockito` + `flutter_test`.

## 14. Related

- [Design system](./DESIGN_SYSTEM.md)
- [Frontend ADR](../architecture/adrs/ADR-0002-flutter.md)