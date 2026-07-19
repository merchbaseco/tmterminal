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
A trademark result set produced from typed data constraints rather than a word-mark search query.
_Avoid_: Saved search, dashboard

**Annual Baseline**:
The exact 91 official annual artifacts through 2025-12-31 used to establish complete historical coverage. Baseline progress never gates live reads.

**Source Artifact**:
One annual or daily transport batch identified by product and filename, with separate download availability/error and projection state/version/error. A completed download retains its verified compressed ZIP for local replay.

**Source Coordinate**:
The product, filename, downloaded SHA-256, and physical record index attached to a projected row.

**Projected Mark**:
The live mark, class, owner, goods/services, and status-event rows produced directly from one selected source record.

**Data Version**:
The monotonic identity of query-visible trademark state. A material artifact commit increments it once; paged requests use it to detect changed data.

**Complete Frontier**:
The contiguous source date through which every required artifact is complete. Rows beyond it may already be live; the frontier describes freshness, not availability.
_Avoid_: Last sync
