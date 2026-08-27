# Bulk Check

A seller pastes independent phrases, one per line. The service returns live exact and partial counts per phrase and shows ordinary Search results for the selected phrase. Counts are not a product-policy verdict.

## Sub-features

- `bulk-compose` — empty Bulk Check composer; textarea; action under the field
- `bulk-submit` — one-to-100 phrases; navigator appears; first phrase with a live match is selected
- `bulk-empty-submit` — empty submit shows `Add a phrase`
- `bulk-too-many` — more than 100 lines shows `Trim to 100` / `Bulk check accepts up to 100 phrases.`
- `bulk-navigator` — selecting another phrase replaces the same result document
- `bulk-open-mark` — a result row opens mark detail and restore returns to the same phrases and selection

## How to get to it (user POV)

- Open `/bulk`
- From an empty Search Marks or Check Text composer, click `Bulk check` in `Search mode`
- After a check, `Check different phrases` returns to the empty Bulk Check composer

## Driving it with the browser

Preconditions:

- Doctor is green and the session is signed in. Cloud phrases (one per line): `GNOME`, `ZZZXQNOTAMARK`, `HARVEST`. Workstation: one known live phrase, one nonsense phrase.

- Compose: Open `/bulk`. Observable: masthead, `Bulk check` current, placeholder shows `One phrase per line`, action `Bulk check` sits under the field.
- Empty submit: Click `Bulk check` with no phrases. Observable: `Add a phrase`; no navigator.
- Submit: Paste the three Cloud lines and click `Bulk check`. Observable: heading `Bulk trademark check`; `Checked phrases` navigator lists each line; `GNOME` is selected (first phrase with a live match, not the first line if a earlier line is empty of live hits — `GNOME` is first here); `Trademark results for GNOME` with a non-zero total. `ZZZXQNOTAMARK` shows no live matches.
- Navigator: Click `HARVEST`. Observable: the result section becomes `Trademark results for HARVEST`; the navigator selection moves; you do not get a second stacked list.
- Open mark: Open a `HARVEST` row, then `Back to results`. Observable: Bulk Check results for `HARVEST` return, not an empty Search Marks page.

## Gotchas

- Bulk Check is counts plus one ordinary Search. It is not a condensed spreadsheet of every hit.
- Default selection is the first phrase with a live match, not necessarily line 1.
- More than 100 lines is rejected, not truncated.
- Mode switcher disappears after a successful check; use `Check different phrases`.
