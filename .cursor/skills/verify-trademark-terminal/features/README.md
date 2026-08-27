# Trademark Terminal verification map

This directory is the maintained source for verifying user-facing website behavior. Read the index before driving the app, then use the matching feature file as the recipe.

`app-feature-verification` in `AGENTS.md` means: run one happy path and the riskiest adjacent path from this map for the change under test. A component test is not a substitute.

## Baseline preconditions

- Doctor is green: `.cursor/skills/verify-trademark-terminal/scripts/doctor.sh`
- Browser origin is the loopback URL the venue advertises (`http://127.0.0.1:5173` in Cloud Agents).
- Cloud: signed in as the Dev Sign-In user; seeded showcase marks exist (`GNOME` and the other solo marks). That account’s saved defaults are not product defaults: Status `Live`, Sort `Newest activity`, 50 per page, comfortable density.
- Workstation: signed in with a real Clerk session against live data. Do not seed. Do not treat `GNOME` as guaranteed.
- Desktop viewport (≥ 48rem) unless the recipe is the mobile menu.
- Never drive a second stack on the same ports.

## Driving conventions

- Start every recipe from `/search` unless its preconditions say otherwise.
- Prefer ARIA names and field labels over CSS or coordinates.
- Type queries into the labeled field and submit the visible action. Do not inject URL state as a substitute for the first search of a proof (shared-URL restore is its own sub-feature).
- Exact serial and registration numbers are identities. Use mark detail or `tt get`, not the search field.
- Restore seeded Cloud preferences after any Account mutation.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes the TRADEMARK / TERMINAL masthead or the sticky search instrument, plus the result summary or empty state.
- Mutation proof (Account preferences) includes a reload or a new `/search` that shows the saved default — and a restore.
- Record the feature ID and entry point with every artifact.
- Report an unreachable path with the attempted handle and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Search Marks](./search-marks.md) covers compose, submit, empty validation, filters, empty results, and shareable URL state.
- [Mark detail](./mark-detail.md) covers opening a result, the record document, back-navigation restore, and the USPTO link (do not use that link as app proof).
- [Check Text](./check-text.md) covers pasting copy, highlight navigation, and the live-exact result list.
- [Bulk Check](./bulk-check.md) covers one-phrase-per-line screening and the phrase navigator.
- [Status](./status.md) covers the public catalog/activity view and the operator source ledger.
