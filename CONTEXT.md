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

**Corpus Generation**:
One complete, query-isolated projection of the pinned annual USPTO source set. A building generation is invisible until atomic activation.

**Source Artifact**:
One annual generation member identified by product, filename, and downloaded SHA-256, with coverage, state, counts, and a current error.

**Source Coordinate**:
The product, filename, downloaded SHA-256, and physical record index attached to a projected row.

**Projected Mark**:
The generation-scoped mark, class, owner, goods/services, and status-event rows produced directly from one selected annual record.

**Corpus Version**:
The monotonic identity of query-visible projected state. Paged requests use it to detect a changed corpus.

**Complete Frontier**:
The contiguous source date through which every required artifact is resolved and published. This is the public corpus-through date.
_Avoid_: Last sync
