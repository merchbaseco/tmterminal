# Check Text

A seller pastes a title or block of copy. The service finds live mark occurrences in that text, highlights them, and lists each distinct matching trademark. Highlighting is navigation, not a risk verdict.

## Sub-features

- `text-compose` — empty Check Text composer with `Check text` and mode switcher
- `text-submit` — paste and submit; the document appears above ordinary results
- `text-empty-submit` — empty submit shows `Paste some text`
- `text-highlights` — overlapping hits form one passage; selecting a passage filters the list
- `text-open-mark` — a result row opens mark detail and restore returns to the same checked text

## How to get to it (user POV)

- Open `/check`
- From an empty Search Marks or Bulk Check composer, click `Check text` in `Search mode`
- After a check, `Check different text` returns to the empty Check Text composer

## Driving it with the browser

Preconditions:

- Doctor is green and the session is signed in. Cloud: paste `I wore my GNOME harvest shirt at the campfire.` Workstation: paste listing copy that should hit a known live mark, or a nonsense sentence for the empty-adjacent path.

- Compose: Open `/check`. Observable: masthead, `Check text` current in `Search mode`, placeholder `Paste a title, description, or block of copy`, action `Check text`.
- Empty submit: Click `Check text` with the field blank. Observable: label becomes `Paste some text`; no result summary.
- Submit: Paste the Cloud sentence and click `Check text`. Observable: heading `Trademark matches in checked text` (screen-reader); checked text region `Checked text with trademark matches`; `Text check results` with a trademark count and `Live exact` > 0; `Live partial` is `0` (text matching returns exact phrase occurrences). At least one `GNOME` row on the seed.
- Highlight: Click a highlighted passage. Observable: the result list narrows to the marks behind that passage; clicking it again restores every distinct mark.
- Open mark: Open one row, then `Back to results`. Observable: the checked text and list return; you do not land on an empty Search Marks page.

## Gotchas

- Partial in the result summary stays zero for Check Text. That is the contract, not a bug.
- Highlights are not a legal verdict. Do not describe them as clearance.
- Mode switcher disappears after a successful check; use `Check different text`.
- Limit is 4096 characters. Do not paste a novel.
