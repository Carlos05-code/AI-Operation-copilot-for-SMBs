# `@smb-copilot/ui`

Design tokens and WCAG utilities for AI Operations Copilot.

Single, AA-verified source of truth for the design system — see
[DESIGN_SYSTEM.md](../../docs/specifications/DESIGN_SYSTEM.md). Tokens are declared in TypeScript
(`src/tokens/`) and exported to web (CSS variables), Flutter (Dart constants), and a
machine-readable JSON snapshot.

## Usage

```ts
import { colors, spacing, typography, contrastRatio } from '@smb-copilot/ui';

colors.primary.light; // "#0f766e" (teal-700)
colors.onPrimary.light; // "#ffffff"
contrastRatio('#ffffff', '#0f766e'); // ~5.8
```

Platform artifacts (committed, no build step needed):

- `generated/tokens.css` — `:root` + `[data-theme="dark"]` custom properties.
- `generated/tokens.dart` — `SMBTokens` class for Flutter.
- `generated/tokens.json` — full flat token snapshot.

## Regenerating

```sh
pnpm build
```

## Verification (CI gate)

`pnpm test` runs unit tests **and** the `check-contrast` script, which fails CI if any
foreground/background token pair drops below WCAG 2.1 AA for text (≥ 4.5:1). Update
`src/tokens/colors.ts` together with `tokenPairs` when adding colors; adjust both schemes to stay
AA-compliant.

## Conventions

- Tokens are numeric or hex primitives — no framework types.
- Every color value has a light and dark variant.
- Public symbols carry JSDoc (CODING_STANDARD.md §6).
