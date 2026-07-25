---
summary: Defines Trademark Turtle component ownership, COSS UI use, Cassette-inspired visual direction, typography, color, themes, and responsive restraint.
read_when:
  - changing shared UI primitives, typography, themes, layout, navigation, search controls, or operator presentation
  - deciding whether to use COSS UI, add a component wrapper, or introduce decorative styling
---

# Design System

Trademark Turtle is a minimalist utilitarian tool. Its visual direction borrows
Cassette's oversized typography, sparse rhythm, and one-color confidence without
copying that site's identity, imagery, texture, or interactions. Steel's technical
editorial grid is the closer reference for product surfaces: compact labels,
deliberate alignment, restrained neutral layers, and one high-confidence action.
Call this treatment **Quiet Utility**: calm documents, precise hierarchy, and
small moments of chartreuse emphasis.

## Components

Use stock [COSS UI](https://coss.com/ui/) components and existing local
`apps/web/src/components/ui/*` copies. Do not customize vendored internals or
build parallel primitives.

Icons come from HugeIcons (`@hugeicons/react` with the
`@hugeicons-pro/core-stroke-rounded` set). Use them only where they improve
recognition, hierarchy, or affordance — search, disclosures, navigation,
appearance, and compact actions — and never as a substitute for necessary text
labels. Installing the scoped icon package requires `HUGEICONS_LICENSE_KEY` in
the environment (see the root `bunfig.toml` registry scope).

Working order:

1. Reuse an existing local primitive.
2. Add the closest stock COSS component when a shared primitive is missing.
3. Compose product behavior in feature code.
4. Add a new dependency only for a capability the current product needs.

## Visual Language

- Archivo Variable is the sole typeface.
- Body copy, navigation, controls, dates, and tooltips use a readable 16px/24px
  body setting. Uppercase utility labels use 12px/16px type with restrained
  tracking. Nothing runs smaller.
- Dialog and section titles may use a restrained 24px/32px setting. This is the
  only intermediate tier; do not invent per-page sizes between body and display.
- Mastheads, primary mark names, search controls, and key catalog statistics use
  heavy fluid display type. Preserve their intentionally extreme scale.
- The shared primary is chartreuse `#D7F52A` in light and dark themes.
- Backgrounds are flat neutrals separated by thin rules. Dark mode is a neutral
  near-black (`#0D0E0E`) with charcoal surfaces; avoid warm olive or brown casts.
- Rounded buttons and navigation pills deliberately contrast with rectilinear
  documents, menus, and technical surfaces. Preserve that contrast.
- Interactive chrome—links, buttons, tabs, menus, and their icons—is
  non-selectable and non-draggable. Ordinary document copy remains selectable.
- Search fields and their primary action form one rectilinear grid row. The
  focused field owns the shared boundary so its chartreuse edge meets the action
  without a second divider. Empty and results states use the same control height,
  column proportions, typography, and square corners.
- Search Marks, Check Text, and Bulk Check use one quiet mode rail attached to
  that grid row. The header exposes one Search destination; the rail owns tool
  selection. Search Marks and Check Text use the same single-line field. Bulk
  Check expands it into a textarea with one full-width accent action beneath it,
  without introducing a separate masthead or form treatment.
- The three-mode rail appears only before a query. Result surfaces replace it
  with one contextual action that floats in the page whitespace above the
  composer and returns to a clean field in the current mode.
- Search is the dominant interaction; results appear directly beneath it.
- Layouts are typographic rows and documents, not card dashboards.
- Utility text stays readable at 12px; navigation uses the body setting.
- Fields and adjacent actions share an exact visual height and vertically
  centered text.

## Appearance

Light, dark, and system modes share the same primary color. Follow system until
the user explicitly chooses; persist only that choice. Root tokens and the
`.dark` class own theme activation. For signed-in users, appearance choices live
inside the account menu rather than as a separate header control. The account
menu shares the dialog surface and radius; its rows align to one left edge and
use whitespace instead of separator bands for grouping.

Text fields use a crisp focus-border color change instead of a glow or outer
ring. Dark mode uses the chartreuse primary; light mode uses a deeper olive for
contrast. Validation errors keep the destructive border while focused.

## Brand

The turtle is a logomark, not a UI mascot. The header presents it as a compact
rounded chip no taller than the adjacent controls. Dark surfaces may use the
transparent chartreuse mark. Light surfaces preserve its near-black field
instead of inverting it; in dark mode the field keeps a hairline border so the
chip stays defined. Additional mascot illustration is deferred.

## Layout

- The header and every page use one 120rem maximum-width shell with identical
  responsive horizontal padding. The sticky header itself stays transparent and
  borderless; its navigation and account controls use restrained translucent
  backgrounds with backdrop blur so scrolling content remains legible beneath
  them. Vertical space separates the header from the page, while navigation,
  mastheads, and page content share the same inner edges.
- Authenticated routes use one shared 24–32px page-start rhythm beneath the
  sticky header. The first visible element—masthead eyebrow, search row, or Back
  link—owns that anchor; page-specific spacing begins beneath it.
- Macro layout stays relatively borderless. Use whitespace and restrained tonal
  changes before adding rules; reserve rules for data structure and major
  document boundaries.
- Structured product documents may use one consistent vertical spine across
  adjacent sections. Let that spine meet full-width horizontal section rules;
  the intersections ground the page without turning every value into a card.
- Primary page mastheads remain intentionally gigantic. Do not reduce their scale
  to make technical controls or metadata feel more conventional.
- Help and Account use one shared masthead treatment: no eyebrow, one static
  expressive title that stays on one line, and one short descriptive line
  beneath it. Status has no separate masthead: its large 30-day activity chart
  is the page anchor and starts at the shared page-start position. Three catalog
  and activity metrics sit above the plot after the aggregate status response
  succeeds, with a compact green `Live` signal aligned to the far right. The
  earliest catalog filing year appears quietly beneath Total trademarks.
- The lead Status chart is an intentional exception to the bounded document
  grammar: its metrics align to the page shell, while the two-series borderless
  plot runs into both viewport edges without an internal grid. Static x-axis
  labels stay inset from the viewport while a quiet dot rail marks the unlabeled
  daily positions. Its Bklit interaction keeps the live date ticker on the
  x-axis and animates the crosshair, both focus segments, and the theme-aware
  value panel together. Its loading state preserves the same metric, plot, and
  information-grid geometry with quiet line pulses instead of a generic loading
  box. Subsequent structured Status surfaces use the same bounded rails and
  content insets as search results. Operator health and source files share one
  ledger surface. Its subtly recessed toolbar gives the `All` and `Errors`
  source-state filters equal, full-height rectilinear cells. Selection uses a
  quiet neutral fill, while counts stay in compact lozenges. The column header
  uses a lighter tonal step before the unfilled data rows. Real issues expand
  inline above the rows.
- The empty search masthead fills the brand state and leaves the layout once a
  query is active.
- Search controls remain prominent and aligned.
- The empty-search masthead and legal footer use whitespace rather than
  separator rules.
- Mark detail uses one aligned label/content spine and rules between major
  sections. Tables, record facts, and status rows still use alignment and
  whitespace rather than boxes around each cell or row dividers.
- Each filter cell is one complete trigger: label, value, and chevron share the
  hit target.
- Search results use a calm two-column editorial row: mark and owner information
  on the left, with status and date in one consistent right-hand rail. Horizontal
  row rules meet that rail; measured vertical rhythm keeps long ranked lists quick
  to scan without returning to the original cramped presentation.
- Result totals form a compact signal strip. The overall count stays quiet while
  live exact and live partial counts remain visible before the ranked list.
- Results use one document scroll; never introduce a nested results viewport.
- Desktop navigation stays text-only and uses compact rounded pills with subtle
  borders and a soft current-page fill. Below 48rem the header collapses to one
  compact menu (stock COSS Menu with a HugeIcons trigger) covering the same
  destinations.
- Desktop filters may stay inline. Mobile filters use a stock disclosure.
- Long lists may use TanStack Virtual over document scroll; TanStack Table is
  not required for editorial rows.
- Returning from mark detail restores loaded results and document position.

## Avoid

- custom COSS component forks;
- cards around every section;
- gradients, glass, shadows, grain, or decorative empty states;
- inconsistent navigation capitalization;
- tiny operator text or raw internal identifiers as primary labels;
- annual/daily source columns or corpus terminology;
- motion without a clear state or orientation benefit.
