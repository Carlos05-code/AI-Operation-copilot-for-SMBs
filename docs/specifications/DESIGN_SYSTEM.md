# Design System

Status: **Draft · v0** · Owner: Carlos05-code

The canonical tokens live in `packages/ui` (single source of truth). This doc
describes semantics; the tokens are exported to **Flutter** (Dart) and **web**
(CSS variables/JS) from the same package.

## 1. Design Principles

- **Calm clarity** — information hierarchy over decoration.
- **Trust** — operations data must feel correct and current.
- **Composable** — small primitives composed into complex flows.
- **Accessible** — WCAG AA contrast, focus, reduced-motion friendly.

## 2. Color Palette

Seeded from Material 3 (`ColorScheme.fromSeed`). Core semantic tokens:

| Token          | Light          | Dark set         | Use                            |
| -------------- | -------------- | ---------------- | ------------------------------ |
| `primary`      | Teal 600       | Teal 200         | primary actions, brand         |
| `onPrimary`    | White          | Near-black       | text on primary                |
| `secondary`    | Blue-grey 700  | Blue-grey 200    | secondary actions              |
| `background`   | Neutral 50     | Neutral 950      | app background                 |
| `surface`      | White          | Neutral 900      | cards, sheets                  |
| `error`        | Red 600        | Red 300          | destructive                    |
| `success`      | Green 600     | Green 300      | positive                       |
| `warning`      | Amber 700      | Amber 300        | attention                      |
| `border`       | Neutral 200    | Neutral 700      | dividers, inputs               |

Contrast checks run in CI (WCAG AA ≥ 4.5 for text, ≥ 3 for icons/large).

## 3. Typography

Based on Roboto (system fallback) for Latin + fallback for CJK.

| Token              | Size/Line | Weight | Use                     |
| ------------------ | --------- | ------ | ----------------------- |
| `display`          | 40/52     | 700    | dashboard hero          |
| `headlineLarge`    | 28/36     | 600    | page title              |
| `headlineMedium`   | 24/30     | 600    | section title           |
| `titleLarge`       | 20/28     | 600    | card title              |
| `bodyLarge`        | 16/24     | 400    | default body            |
| `bodyMedium`       | 14/20     | 400    | dense body, table       |
| `labelLarge`       | 14/20     | 600    | buttons, tags           |
| `bodySmall`        | 12/16     | 400    | captions, meta          |

- Use `TextTheme` extensions; follow fluid scaling `TextScaler.linear`(1..1.3).

## 4. Shape & Radii

| Token  | Value | Use |
| ------ | ----- | --- |
| `radius.none` | 0 | tables, precision |
| `radius.sm` | 4 | inputs, chips |
| `radius.md` | 8 | buttons, cards |
| `radius.lg` | 12 | dialogs, panels |
| `radius.circle` | 50% | avatars, badges |

## 5. Spacing (4px grid)

`space.1=4, space.2=8, space.3=12, space.4=16, space.5=20, space.6=24,
 space.8=32, space.10=40, space.12=48`.

## 6. Elevation / Shadow

Semantic `shadow.1..3` (tooltips → modal overlays). Dark mode reduces shadow
per Material 3 guidance.

## 7. Icons

- `icons/` in `packages/ui` as Material Icons (Flutter) + SVG set for web.
- Consistent stroke: rounded 24px frame, 2dp stroke (configurable color only).
- Icon-only controls require `tooltip` + `Semantics`.

## 8. Motion

| Motion | Duration | Curve | Use |
| ------ | -------- | ----- | --- |
| `fast` | 120 ms | ease-out | micro feedback (hover) |
| `base` | 200 ms | easeInOut | standard transition |
| `slow` | 320 ms | decel | page/panel transitions |
| `enter/exit` | 240 ms | ease | dialog/menu |

- Respect `reduce-motion`: disable non-essential animations (systemd flag).

## 9. Components (first-pass list)

| Group        | Components                                  |
| ------------ | ------------------------------------------- |
| Inputs       | TextField, Select, DateRange, AmountInput, Upload |
| Feedback     | Toast, Snackbar, Alert, Modal, Skeleton, EmptyState |
| Data display | DataTable, StatCard, Sparkline, KPI, Tag, Avatar, Timeline |
| Navigation   | TopBar, NavRail, Tabs, Breadcrumb, CommandPalette |
| Actions      | Button, IconButton, Dropdown, ConfirmDialog, ActionSheet |
| AI          | ChatBubble, CitationChip, ConfidenceGauge, StreamingDot |

- All components are token-powered; no card/app-local colors.

## 10. Interaction guidelines

- Buttons: primary for default action, secondary for alternatives, text/ghost
  for low priority; destructive always visible label.
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
- Keyboard: Tab order logical; shortcut map (mobile: icons, desktop: shortcuts).
Responsible: `packages/ui` owner.

## 14. Ownership

- One owner per component; tokens in `packages/ui`; changes are PR-reviewed
  against this spec and update the storybook/Gallery.

## 15. Versioning

- Tokens versioned with the package; breaking changes bump major + migration notes.