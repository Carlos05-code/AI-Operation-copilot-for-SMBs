# ADR-0002: Flutter as the single client framework

- Status: Accepted
- Date: 2026-08-02
- Owner: Carlos05-code
- Deciders: Frontend Team

## Context

The platform needs clients on mobile (iOS/Android), web, and desktop from one
codebase with high code reuse, near-native performance, and a great offline story.
Alternatives considered: React Native, SwiftUI+KMP, plain web (React), Flutter.

## Decision

Build the client with **Flutter** (current stable channel).

- Single Dart codebase → mobile, web, desktop.
- State management via **Riverpod**, routing via **GoRouter**, networking via **Dio**.
- Feature-first, Clean Architecture layout (see FRONTEND_SPEC).

## Alternatives

| Option | Trade-off |
| ------ | --------- |
| React Native | JS toolchain, weaker desktop story; mature on mobile |
| Native (SwiftUI + Jetpack Compose) | Two full codebases, two teams |
| Web-only (React) | No native app distribution, offline harder |

## Pros

- One codebase ships everywhere; pulse of consistent UX.
- Very good offline storage & state tooling.
- Compiles to native; strong custom widgets.

## Cons

- Dart ecosystem smaller than JS.
- Web performance is sometimes laggy for heavy pages (soon acceptable).

## Consequences

- All client code lives in `apps/mobile/` with feature-first structure.
- Design tokens shared with web via `packages/ui` where needed.
- Automated widget + golden testing part of gate (TESTING_SPEC).

## References

- [mobile/](../../apps/mobile/)
- [FRONTEND_SPEC](../specifications/FRONTEND_SPEC.md)