# Search Marks

A seller types a word mark, submits Search, and gets a ranked Class 025 list with live exact and live partial counts. Filters and sort apply immediately. Query edits wait for Search or Enter.

## Sub-features

- `search-compose` — empty brand page with masthead, field, Search, and mode switcher
- `search-submit` — typed query plus Search or Enter loads results and collapses the masthead
- `search-empty-submit` — empty Search shows `Give me a word` and keeps focus in the field
- `search-empty-results` — a query with no hits shows `0 results` and `No marks match “…”`
- `search-filters` — Status, Type, Registered, and Sort change the same result document without another Search click
- `search-share-url` — the address bar encodes `q`, `mode`, match flags, filters, and sort
- `search-start-over` — `Start a new search` returns to the empty composer in Search Marks

## How to get to it (user POV)

- Open `/` or `/search`, or click `Trademark Terminal home`, or primary nav `Search`
- From Check Text or Bulk Check, click `Search marks` in `Search mode` (empty composer only)
- After results, `Start a new search` stays in Search Marks
- Signed-out: same composer; submit opens Clerk and keeps `q` in the URL

## Driving it with the browser

Preconditions:

- Doctor is green. Cloud: signed in, seed present. Use query `GNOME` for hits and `ZZZXQNOTAMARK` for empty results. Workstation: pick a real word and a nonsense word.
- Start at `http://127.0.0.1:5173/search` (or the workstation loopback origin).

- Compose: See heading `TRADEMARK TERMINAL` and placeholder `Search a word mark`. Mode nav shows `Search marks` as the current page. Proof: screenshot of the empty brand page.
- Empty submit: Click `Search` with the field blank. Observable: button label becomes `Give me a word`; polite status text matches; field stays focused; URL has no `q`.
- Submit: Type `GNOME` into `Search trademarks` and click `Search` (or press Enter). Observable: URL contains `q=GNOME` and `mode=multi`; page shows `Searching Class 025…` then `Search results` with a total other than `0 results`, plus `Live exact` and `Live partial` counts; at least one `Trademark results` row whose name includes `GNOME` and an eight-digit serial. Live exact and live partial must differ on the seed (crowded families). A Cloud seed search typically lands Status `Live` and Sort `Newest activity` from saved account defaults.
- Empty results: `Start a new search`, type `ZZZXQNOTAMARK`, submit. Observable: `0 results`, `0 Live exact`, `0 Live partial`, and the large crossed-circle empty graphic. The accessible name is `No marks match “ZZZXQNOTAMARK”` — that sentence is not painted on the page. Filters remain. No recovery copy.
- Filters: From a `GNOME` result set, set Status to `Live`. Observable: the request runs without clicking Search again; total does not increase; every visible status chip is `Live`. Restore Status to `All` before leaving if later recipes need both sides.
- Share URL: Copy the address after a successful search. Observable: it includes `q`, `exact`, `partial`, `status`, `type`, `registered`, `sort`, and `mode=multi`. Opening that URL in the same session restores the same query (loaded scroll depth is not in the URL).

## Gotchas

- Editing the field after a successful search does not replace results until the next Search succeeds.
- Exact serials are not search terms. Opening `/marks/12345678` is mark detail, not Search Marks.
- Mode switcher (`Search marks` / `Check text` / `Bulk check`) is only on the empty composer. After results it yields to `Start a new search`.
- Account preferences seed only a new search. A URL with explicit params wins.
- Workstation live data will not contain `GNOME` as a showcase family. Do not fail a live proof because seed counts differ.
- Signed-out submit is Clerk, not a 401 page. Do not complete a seller's live sign-in unless this run owns that account.
- `Give me a word` replaces the Search label for about 1.8 seconds and is also a polite `role=status`. Miss it if you look away.
- The empty-results graphic is a faint circle with a diagonal bar. It is not a spinner. Do not fail the path because the words `No marks match` are missing from the pixels.
