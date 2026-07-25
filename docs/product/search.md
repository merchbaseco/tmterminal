---
summary: Defines search modes, filters, sorting, results, mark detail, text matching, bulk screening, URL state, and live-data behavior.
read_when:
  - changing search validation, ranking, filters, pagination, results, matching, screening, or mark detail
  - changing website routes or customer-facing trademark status semantics
---

# Search

Search, exact lookup, text matching, listing, and screening always query the database's
current best-known trademark state. Ingestion progress never gates them. An
empty database returns empty results; an absent exact identity returns not
found.

All statuses are included by default. Filters narrow results; inactive marks
remain legitimate trademark records.

## Search Modes

| Mode | Meaning |
| --- | --- |
| Multi | Search the query as written, with exact, partial, or both match kinds. |
| Split | Search exact matches for every adjacent Unicode letter, mark, or number token combination; punctuation separates tokens. |
| Wildcard | Match the whole normalized mark; `*` means zero or more characters and every other metacharacter is literal. Patterns containing `*` require a literal Unicode word run of at least three characters. |

Multi is the default. Query and mode edits wait for Search or Enter. Filter and
sort changes apply immediately. Editing a query does not replace successful
results until the next request succeeds.

Account preferences may choose the initial Multi match kind, status, sort,
request size, and compact or comfortable result density. They seed only a new
search. Explicit URL parameters remain authoritative so shared and restored
searches are stable. Search requests accept 25, 50, or 100 results per load.

The empty page is the brand state: the oversized masthead, search field, action,
and legal disclaimer fit one desktop viewport without redundant explanation.
Once a query is active, the masthead leaves the layout and sticky search controls
turn the page into a compact search instrument.

Search Marks, Check Text, and Bulk Check share one website composition and one
mode switcher attached to its input surface. Search Marks uses a single-line
field, as does Check Text. Bulk Check expands the same field into a textarea and
places its action directly beneath it while preserving the page rhythm and
ordinary results presentation.
The primary navigation links to Search once; the mode switcher owns movement
between the three tools.

Once results are visible, the mode switcher yields to one contextual action that
starts a clean search or check in the current mode.

## Filters And Sorts

Visible filters:

- Status: All, Live, Dead.
- Type: All, Design, Typeset, Text.
- Registered: All, Yes, No.

The website does not expose a class filter while the service tracks only Class
025. International classes remain visible source facts.

Sorts:

- Relevance: exact before partial, then relevance.
- Newest activity: descending source transaction date.
- Oldest activity: ascending source transaction date.

Every order ends with serial number for stable pagination.

## Results And Detail

Results are one dense, ranked, full-width list. Each row presents the word mark,
owner, concise mark type, match label when partial, canonical disposition, and
status date. International classes appear only when a mark includes a class
outside the default Class 025 scope. Goods statements and identity numbers stay
on detail so the ranked list remains scannable. Infinite scroll loads
server-filtered account-sized pages; returning from detail restores loaded pages
and document position.

The result summary shows total results plus live exact and live partial counts so
the seller sees the primary go/no-go signal before scanning rows.

`/marks/:serial-number` is a stable route. Its single document includes:

- word mark, mark type, and status;
- serial, registration, filing, registration, and status dates;
- owner, classes, and goods/services;
- distinct source-reported status transitions, newest first, with histories
  longer than five events disclosed behind an explicit control;
- one external action opening the official USPTO record (TSDR) for the serial
  number in a new tab.

Winning source provenance remains in the `marks.get` API payload for operator
and CLI consumers; the website does not render it. Goods/services follow the
heading, pair each `GS` statement with its international class code, order Class
025 `GS` statements first, and fall back to other source statements only when
`GS` is absent. The website presents those pairs as a full-width class and
description table that grows vertically; mark type belongs to the compact record
facts grid beneath it. Status history does not label an
event current or latest because canonical disposition may come from other
source state. Repeated observations do not create duplicate user-visible
events.

## Text Matching

Text matching accepts one to 100 named Text Documents. It returns one ordered
result per document. Each occurrence keeps its half-open JavaScript UTF-16 span
and groups every matching live trademark record. The server owns combined
candidate generation, normalization, filtering, and one repeatable-read Data
Version. It never silently truncates matches.

The Check Text website renders the submitted document immediately above the
ordinary trademark result list. Overlapping occurrences form one highlighted
passage. Selecting a passage filters the result list to the distinct marks
behind that passage; clearing the selection restores every distinct mark found
in the document. Distinct phrases use a consistent bright color shared by their
highlights and result-row indicators. Hover or keyboard focus discloses the
distinct matching-mark count without delay. The result summary retains the
ordinary live exact and live partial signals; text matching currently returns
exact phrase occurrences, so partial remains zero. Highlighting is navigation,
not a risk verdict.

## Bulk Screening

Bulk screening accepts one to 100 named independent phrases. It returns ordered
live exact and partial counts, not a legal or product-policy verdict. Callers
open ordinary Search for records and own any ignored-mark, warning, or approval
policy.

The Bulk Check website uses those counts as a phrase navigator. It selects the
first phrase with a live match by default and renders that phrase's ordinary
paginated Search results below the navigator. Selecting another phrase replaces
the same result document. It does not create a separate condensed result table
or request an unbounded result set for every phrase at once.

## Routes And URL State

```text
/                         search composition
/search?...               Search Marks mode and shareable search state
/check                    direct entry to Check Text mode
/bulk                     direct entry to Bulk Check mode
/marks/:serial-number     mark detail
/account                  Account and API-key management
/status                   public status; operator details for approved admins
/help                     public search and data help
```

Search URLs encode submitted query, mode, match options, filters, and sort.
Loaded infinite-scroll depth is navigation state, not URL state.

## Help

The public Help page explains Multi, Split, and Wildcard search; result status,
type, identity, and filters; the USPTO source; and the legal disclaimer. It uses
customer language and does not expose parser or source-file internals.

## States

- Initial results use three typographic skeleton rows.
- Mark detail uses a structural document skeleton that preserves its final grid,
  static line boxes, section labels, and five-row history preview while the
  record loads.
- Loading more uses one inline spinner row.
- Empty results say `No matching marks` and offer Clear filters.
- Validation stays beneath the search field.
- Data Version conflict shows Run search again; it never mixes old and new pages.
- Service failure uses a full-width alert and never presents stale results as
  current.

## Related

- [HTTP API](../reference/http-api.md)
- [CLI](../reference/cli.md)
- [Data model](../reference/data-model.md)
