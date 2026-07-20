---
summary: Defines Trademark Turtle component ownership, COSS UI use, Cassette-inspired visual direction, typography, color, themes, and responsive restraint.
read_when:
  - changing shared UI primitives, typography, themes, layout, navigation, search controls, or operator presentation
  - deciding whether to use COSS UI, add a component wrapper, or introduce decorative styling
---

# Design System

Trademark Turtle is a minimalist utilitarian tool. Its visual direction borrows
Cassette's oversized typography, sparse rhythm, and one-color confidence without
copying that site's identity, imagery, texture, or interactions.

## Components

Use stock [COSS UI](https://coss.com/ui/) components and existing local
`apps/web/src/components/ui/*` copies. Do not customize vendored internals or
build parallel primitives.

Working order:

1. Reuse an existing local primitive.
2. Add the closest stock COSS component when a shared primitive is missing.
3. Compose product behavior in feature code.
4. Add a new dependency only for a capability the current product needs.

## Visual Language

- Archivo Variable is the sole typeface.
- Body copy, navigation, metadata, controls, dates, and tooltips use one readable
  16px/24px body setting. Uppercase utility labels use 12px type with restrained
  tracking. Nothing runs smaller.
- Mastheads, primary mark names, search controls, and key catalog statistics may
  use heavy display type. Avoid intermediate type sizes that create a second
  hierarchy between body and display.
- The shared primary is chartreuse `#D7F52A` in light and dark themes.
- Backgrounds are flat neutrals separated by thin rules.
- Search is the dominant interaction; results appear directly beneath it.
- Layouts are typographic rows and documents, not card dashboards.
- Utility text stays readable at 12px; navigation uses the body setting.
- Fields and adjacent actions share an exact visual height and vertically
  centered text.

## Appearance

Light, dark, and system modes share the same primary color. Follow system until
the user explicitly chooses; persist only that choice. Root tokens and the
`.dark` class own theme activation.

## Brand

The turtle is a logomark, not a UI mascot. Dark surfaces may use the transparent
chartreuse mark. Light surfaces preserve its near-black field instead of
inverting it. Additional mascot illustration is deferred.

## Layout

- The header and every page use one 120rem maximum-width shell with identical
  responsive horizontal padding. Full-bleed header rules may span the viewport;
  navigation, mastheads, and page content share the same inner edges.
- The empty search masthead fills the brand state and leaves the layout once a
  query is active.
- Search controls remain prominent and aligned.
- Each filter cell is one complete trigger: label, value, and chevron share the
  hit target.
- Results use one document scroll; never introduce a nested results viewport.
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
