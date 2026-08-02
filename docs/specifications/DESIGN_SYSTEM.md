# Design System

Status: **Ratified · v1** · Owner: Carlos05-code

The canonical tokens live in `packages/ui` (single source of truth). This doc describes semantics;
the tokens are exported to **Flutter** (Dart) and **web** (CSS variables/JS) from the same package.
Generated artifacts are committed at `packages/ui/generated/*` (CSS, Dart, JSON).

## 1. Design Principles

- **Calm clarity** — information hierarchy over decoration.
- **Trust** — operations data must feel correct and current.
- **Composable** — small primitives composed into complex flows.
- **Accessible** — WCAG AA contrast, focus, reduced-motion friendly.

## 2. Color Palette

Seeded from Material 3 (`ColorScheme.fromSeed`). Values below are the AA-verified hexes enforced by
`check-contrast` in CI; `on*` tokens name the text/icon foreground for each surface.

| Token          | Light     | Dark      | Use                    |
| -------------- | --------- | --------- | ---------------------- |
| `primary`      | `#0f766e` | `#99f6e4` | primary actions, brand |
| `onPrimary`    | `#ffffff` | `#043c35` | text on primary        |
| `secondary`    | `#334155` | `#a8c1cf` | secondary actions      |
| `onSecondary`  | `#ffffff` | `#0a2431` | text on secondary      |
| `background`   | `#f8fafc` | `#020617` | app background         |
| `onBackground` | `#0f172a` | `#f1f5f9` | text on background     |
| `surface`      | `#ffffff` | `#0f172a` | cards, sheets          |
| `onSurface`    | `#0f172a` | `#f1f5f9` | text on surface        |
| `error`        | `#b3261e` | `#f2b8b5` | destructive            |
| `onError`      | `#ffffff` | `#331111` | text on error          |
| `success`      | `#1b8732` | `#a5d6a7` | positive               |
| `onSuccess`    | `#ffffff` | `#0d2b13` | text on success        |
| `warning`      | `#9a6700` | `#ffd54f` | attention              |
| `onWarning`    | `#ffffff` | `#3d2f00` | text on warning        |
| `border`       | `#d1d5db` | `#334155` | dividers, inputs       |
| `onBorder`     | `#0f172a` | `#e2e8f0` | text on border         |

Contrast is enforced in CI by `packages/ui/scripts/check-contrast.ts`: every fg/bg token pair must
meet WCAG 2.1 AA (≥ 4.5) in both schemes; the script prints failing pairs and exits non-zero. Any
color change must keep the full pairset passing.

## 3. Typography

Based on Roboto (system fallback) for Latin + fallback for CJK.

| Token            | Size/Line | Weight | Use               |
| ---------------- | --------- | ------ | ----------------- |
| `display`        | 40/52     | 700    | dashboard hero    |
| `headlineLarge`  | 28/36     | 600    | page title        |
| `headlineMedium` | 24/30     | 600    | section title     |
| `titleLarge`     | 20/28     | 600    | card title        |
| `bodyLarge`      | 16/24     | 400    | default body      |
| `bodyMedium`     | 14/20     | 400    | dense body, table |
| `labelLarge`     | 14/20     | 600    | buttons, tags     |
| `bodySmall`      | 12/16     | 400    | captions, meta    |

- Use `TextTheme` extensions; follow fluid scaling `TextScaler.linear`(1..1.3).

## 4. Shape & Radii

| Token           | Value | Use               |
| --------------- | ----- | ----------------- |
| `radius.none`   | 0     | tables, precision |
| `radius.sm`     | 4     | inputs, chips     |
| `radius.md`     | 8     | buttons, cards    |
| `radius.lg`     | 12    | dialogs, panels   |
| `radius.circle` | 50%   | avatars, badges   |

## 5. Spacing (4px grid)

`space.1=4, space.2=8, space.3=12, space.4=16, space.5=20, space.6=24,  space.8=32, space.10=40, space.12=48`.

## 6. Elevation / Shadow

Semantic `shadow.1..3` (tooltips → modal overlays). Dark mode reduces shadow per Material 3
guidance.

## 7. Icons

- `icons/` in `packages/ui` as Material Icons (Flutter) + SVG set for web.
- Consistent stroke: rounded 24px frame, 2dp stroke (configurable color only).
- Icon-only controls require `tooltip` + `Semantics`.

## 8. Motion

| Motion       | Duration | Curve     | Use                    |
| ------------ | -------- | --------- | ---------------------- |
| `fast`       | 120 ms   | ease-out  | micro feedback (hover) |
| `base`       | 200 ms   | easeInOut | standard transition    |
| `slow`       | 320 ms   | decel     | page/panel transitions |
| `enter/exit` | 240 ms   | ease      | dialog/menu            |

- Respect `reduce-motion`: disable non-essential animations (systemd flag).

## 9. Components (first-pass list)

| Group        | Components                                                 |
| ------------ | ---------------------------------------------------------- |
| Inputs       | TextField, Select, DateRange, AmountInput, Upload          |
| Feedback     | Toast, Snackbar, Alert, Modal, Skeleton, EmptyState        |
| Data display | DataTable, StatCard, Sparkline, KPI, Tag, Avatar, Timeline |
| Navigation   | TopBar, NavRail, Tabs, Breadcrumb, CommandPalette          |
| Actions      | Button, IconButton, Dropdown, ConfirmDialog, ActionSheet   |
| AI           | ChatBubble, CitationChip, ConfidenceGauge, StreamingDot    |

- All components are token-powered; no card/app-local colors.

## 10. Interaction guidelines

- Buttons: primary for default action, secondary for alternatives, text/ghost for low priority;
  destructive always visible label.
- Confirm destructive mutations (> impact).
- Empty states always have a "Next step" call-to-action.
- Every AI output includes copy, thumbs-up, and thumbs-down affordances.

## 11. Responsive rules

- `compact` (<600): bottom nav, single column, sheet-based filters.
- `medium` (600–1024): rail navigation, two-column detail.
- `expanded` (>1024): full nav rail, three-column density, wide tables.
- Breakpoints are tokenized; grid from layout primitives in `packages/ui`.

## 12. Dark Mode

- Theme derived from same seeds; surface elevation color steps spaced.
- Dark mode: automatic with OS preference plus per-user override.
- Contrast validated separately in CI for the dark scheme.

## 13. Accessibility

- Target WCAG AA.
- Screen-reader text, labels, focus trap in dialogs.
- Keyboard: Tab order logical; shortcut map (mobile: icons, desktop: shortcuts). Responsible:
  `packages/ui` owner.

## 14. Ownership

- One owner per component; tokens in `packages/ui`; changes are PR-reviewed against this spec and
  update the storybook/Gallery.

## 15. Versioning

- Tokens versioned with the package; breaking changes bump major + migration notes.
