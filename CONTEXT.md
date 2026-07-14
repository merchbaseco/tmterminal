# Trademark Turtle

Trademark Turtle is the domain for discovering, maintaining, and searching United States trademark records for print-on-demand sellers.

## Language

**Search Query**:
The single word-mark phrase or wildcard pattern submitted for a search.
_Avoid_: Batch query, query list

**Search Mode**:
The interpretation applied to a search query: Multi, Split, or Wildcard.
_Avoid_: Search type, match algorithm

**Multi**:
Searches the query as written. Results may include exact matches, partial matches, or both.

**Exact Match**:
A word mark that equals the search query.

**Partial Match**:
A word mark that contains the search query.
_Avoid_: Fuzzy match

**Split**:
Searches for exact matches to every adjacent word combination in the query, from individual words through the complete phrase.

**Wildcard**:
Searches the query as a pattern in which `*` represents zero or more characters.

**Report**:
A trademark result set produced from typed corpus constraints rather than a word-mark search query.
_Avoid_: Saved search, dashboard

**Source Observation**:
One immutable USPTO `case-file` occurrence with artifact, action-key, ordering, presence, and parser provenance. It may assert only part of a mark.
_Avoid_: Snapshot, canonical row

**Canonical Mark**:
The rebuildable current trademark materialization produced by folding eligible source observations for one serial number.

**Corpus Version**:
The monotonic identity of query-visible canonical state. Paged requests use it to detect a changed corpus.

**Complete Frontier**:
The contiguous source date through which every required artifact is resolved and published. This is the public corpus-through date.
_Avoid_: Last sync
