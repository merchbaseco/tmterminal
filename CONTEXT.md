# Trademark Terminal

Trademark Terminal discovers, maintains, and searches United States trademark
records for print-on-demand sellers. This file owns shared nouns. Product,
internal, reference, and operational details live in [`docs/`](docs/README.md).

## Language

**Search Query**:
The single word-mark phrase or wildcard pattern submitted for search.
_Avoid_: Query list

**Screen Query**:
One independent word-mark phrase in a Trademark Screen.
_Avoid_: Listing, Batch search term

**Trademark Screen**:
An ordered batch of Screen Queries evaluated for live exact and partial match
counts. It returns evidence for caller-owned policy; it does not declare a
phrase safe.
_Avoid_: Bulk query, Listing checker, Safety check

**Search Mode**:
The interpretation applied to a Search Query: Multi, Split, or Wildcard.
_Avoid_: Search type, Match algorithm

**Multi**:
Search the query as written for exact matches, partial matches, or both.

**Exact Match**:
A word mark equal to the Search Query.

**Partial Match**:
A word mark containing the Search Query.
_Avoid_: Fuzzy match

**Split**:
Search exact matches for every adjacent Unicode word-token combination in the
query.

**Wildcard**:
Search the whole mark using a pattern where `*` means zero or more characters.

**Text Match**:
One occurrence found in a named Text Document, paired with a half-open
JavaScript UTF-16 source span and every live word mark for that occurrence.
Every overlapping occurrence is retained.

**Text Document**:
Caller-owned text with a stable caller-supplied identity. Text Documents are
matched together in one Data Version.
_Avoid_: Listing field, Blob

**Live Trademark Knowledge**:
The database's current best-known trademark state. Every committed safe update
is immediately searchable.
_Avoid_: Corpus, Published dataset, Active generation

**Data Query**:
Search, identity lookup, text matching, listing, or screening over Live
Trademark Knowledge. It never checks ingestion readiness.
_Avoid_: Corpus query, Published-data query

**Data Version**:
The monotonic identity of query-visible trademark state used to detect changes
between result pages.

**Source Artifact**:
One logical USPTO transport file identified by product and filename. Its ledger
row keeps acquisition, application, counts, provenance, and current issue facts;
provider frequency does not change its behavior.

**Coverage Group**:
Source Artifacts with the same exact coverage range. It identifies equivalent
provider packaging without creating a release or query gate.
_Avoid_: Annual release, Publication set

**Source Bootstrap**:
The one-time selection of the broadest initial Coverage Group plus only narrower
files ending after it. Displaced historical files remain visible as covered.
_Avoid_: Corpus bootstrap, Annual mode

**Processing Disposition**:
Whether a discovered Source Artifact is `required`, `deferred` while a selected
broader source is pending, or `covered` after that broader source applies.
_Avoid_: Queue state, Annual priority

**Download State**:
The acquisition lifecycle `pending`, `downloading`, `downloaded`, or `blocked`.
Downloaded remains a historical fact after temporary bytes are cleaned.
_Avoid_: Application state, Provider state

**Download Request**:
One provider request for a specific source file, counted before it is sent.
Source discovery is not a Download Request.

**Blocked Download**:
A Source Artifact whose bytes were not obtained and which cannot be requested
again without an operator decision.
_Avoid_: Parse failure, Provider backoff

**Raw Source File**:
Temporary verified ZIP bytes retained until successful application and cleanup,
or longer when a deterministic Application Issue needs replay.
_Avoid_: Backup file, Published artifact

**Application State**:
The database-processing lifecycle `pending`, `applying`, `complete`, or
`needs_attention`.
_Avoid_: Corpus state, Publication state

**Artifact Application**:
Complete validation followed by bounded, immediately visible database updates
from one Raw Source File. It processes one file end-to-end.
_Avoid_: Corpus publication, Generation activation

**Application Issue**:
A deterministic document or record interpretation problem isolated to one
Source Artifact. It does not gate unrelated files or Data Queries.
_Avoid_: System failure, Retry queue

**System Failure**:
A database, disk, artifact-store, or worker-code failure that prevents
trustworthy ingestion and stops the worker without changing source meaning.
_Avoid_: Source issue, Provider failure

**Parser Version**:
A monotonically increasing integer for source-interpretation semantics. Refactors
and performance changes do not increment it.
_Avoid_: Build version, Schema version

**Source Coordinate**:
The product, filename, content revision, SHA-256, and physical record index that
identify one source record.

**Source Transaction Date**:
The USPTO process date that orders trademark snapshots. Artifact coverage,
filename, download time, and processing time are not record recency.
_Avoid_: Status date, File date, Effective date

**Source Activity**:
The Source Transaction Date that ordered the current Projected Mark.
_Avoid_: Status date, Ingestion time

**Usable Snapshot**:
A source record with valid recency and enough identity, mark, and classification
data to replace one trademark as a whole. Sparse records never partially patch
live state.
_Avoid_: Claim, Partial update

**Tracked Classes**:
The private code constant of international classes for which Trademark Terminal
materializes complete searchable details. V1 is `['025']`.
_Avoid_: Class 025 schema, Runtime class setting

**International Class 025 Evidence**:
Explicit `international-code` 025, or `primary-code` 025 for an application filed
on or after 1973-09-01.
_Avoid_: Any primary code 025

**Trademark Recency**:
Minimal winning source date, coordinate, and Parser Version for every processed
serial. It prevents older replays from creating stale tracked data without
storing full nontracked marks.
_Avoid_: Source record archive, Tombstone

**Projected Mark**:
The current mark and its class, owner, goods/services, and status-event children
from one winning Usable Snapshot. Inactive status does not delete it.

**Latest Processed**:
The newest source coverage date whose document validated and whose safe records
were applied. Separate issues explain any unresolved records.
_Avoid_: Complete through, Data frontier

**Needs Attention**:
The current list of System Failures, Blocked Downloads, and Application Issues.
It is active state, not issue history.
_Avoid_: Corpus health, Sync stopped

**Source Status**:
Latest Processed, Needs Attention, worker state, and the browsable Source
Artifact ledger presented in customer-quality language.
_Avoid_: Corpus freshness, Sync dashboard

**Source Discovery**:
The daily read of official USPTO metadata that records newly visible Source
Artifacts without downloading their bytes.
_Avoid_: Sync cursor, Download

**Historical Repair**:
An explicit operator action that reapplies one Source Artifact with deployed
semantics while existing data stays searchable.
_Avoid_: Corpus rebuild, Automatic backfill

**In-place Cutover**:
Migration from the deployed ingestion model while preserving accounts, marks,
provenance, and truthful source history. There is no empty-search interval or
activation switch.
_Avoid_: Rebuild cutover, Generation switch
