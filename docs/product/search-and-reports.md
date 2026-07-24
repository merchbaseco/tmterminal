---
summary: Defines search modes, filters, sorting, results, mark detail, text matching, reports, URL state, and live-data behavior.
read_when:
  - changing search validation, ranking, filters, pagination, results, reports, or mark detail
  - changing website routes or customer-facing trademark status semantics
---

# Search And Reports

Search, exact lookup, text matching, and reports always query the database's
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

The empty page is the brand state: the oversized masthead, search field, action,
and legal disclaimer fit one desktop viewport without redundant explanation.
Once a query is active, the masthead leaves the layout and sticky search controls
turn the page into a compact search instrument.

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
server-filtered 25-item pages; returning from detail restores loaded pages and
document position.

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

Text matching finds all overlapping live word-mark candidates in submitted
text. The server owns candidate generation, normalization, filtering, and
stable UTF-16 offsets. It never silently truncates matches.

## Reports

Reports are typed result sets, not stored searches or custom dashboards. They
reuse result rows, filters, sorting, count, and pagination. The HTTP client and
CLI expose them for programmatic use; the website does not present report pages.

| Preset | Meaning |
| --- | --- |
| Filed, previous week | Filing date falls in the previous Monday-through-Sunday window. |
| Registered, previous week | Registration date falls in that window. |
| Published for opposition | Current USPTO status is Published for Opposition; no claim is made about a legally open opposition window. |

The defining report constraint is fixed; status, type, registration, and sort
remain adjustable.

Each report includes a compact overview of its complete result set, independent
of the current result page. Previous-week reports group counts by each day in
the resolved Monday-through-Sunday window. Published-for-opposition groups the
current result set by mark type. The overview and list use the same defining
report constraint and adjustable filters.

## Routes And URL State

```text
/                         search composition
/search?...               shareable search state
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
