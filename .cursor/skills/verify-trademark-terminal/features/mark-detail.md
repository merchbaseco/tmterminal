# Mark detail

A seller opens one result and reads the current USPTO-derived record: word mark, status, identities, goods/services, and status history. The page is a stable `/marks/{8-digit-serial}` document.

## Sub-features

- `detail-from-results` — click a result row and land on that serial
- `detail-document` — word mark, status chip, dates, owner, goods/services table, history
- `detail-back` — `Back to results` restores the search list and scroll when the seller arrived from search
- `detail-uspto-link` — `Open official USPTO record` points at TSDR for that serial (do not browse TSDR as proof)
- `detail-unknown` — a serial that is not in the database is not found, not an empty search

## How to get to it (user POV)

- From Search Marks, Check Text, or Bulk Check results, activate a row whose accessible name is `{word mark}, {status}, serial number {serial}`
- Open `/marks/{serial}` directly (bookmark or CLI follow-up)
- Browser Back after `detail-from-results` is equivalent to `Back to results` when history says the seller came from search

## Driving it with the browser

Preconditions:

- A search or check has visible rows, or you already know an eight-digit serial from this venue (Cloud: any `GNOME` row).
- Do not invent a serial.

- Open: Click the first `GNOME` result. Observable: path is `/marks/` plus eight digits; heading is the word mark (seed: `GNOME`); a status chip `Live`, `Dead`, or `Status unavailable`; `Back to results` is present.
- Document: Wait until `Loading trademark` is gone. Observable: `Goods/services` table with Class and Description; a record facts area that includes the same eight-digit serial; `Open official USPTO record` href contains `caseNumber=` and that serial. History may hide events past the first five behind an explicit control.
- Back: Click `Back to results`. Observable: return to the previous tool URL and result list; the opened serial is still represented. If you opened `/marks/…` cold, Back goes to `/search` instead of a list.
- Adjacent not-found: Open `/marks/00000000`. Observable: a not-found state for that identity, not a `GNOME` list and not a hang on the skeleton.

## Gotchas

- The website does not render source provenance. Missing SHA or filename on the page is correct.
- Goods/services prefer `GS` statements and put Class 025 first. Absence of other classes is normal.
- Status history does not label a row current. Canonical disposition is the chip, not the newest event.
- Do not follow the USPTO link as evidence that Trademark Terminal works.
- Infinite-scroll restore is in-session history, not the URL. A full reload of `/search?q=…` starts at the first page.
