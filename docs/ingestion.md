---
summary: Defines perpetual live USPTO ingestion, retained source artifacts, replay, and data freshness.
read_when:
  - changing USPTO discovery, downloads, parsing, projection, replay, or freshness
  - changing source coordinates, live-data updates, daily continuation, or status derivation
---

# USPTO ingestion

PostgreSQL is Trademark Turtle's perpetual product state. Annual and daily USPTO files are transport batches, not query-visible datasets. Every committed batch updates the same live Class 025 tables and is immediately searchable. Partial and empty databases remain valid query states.

One deep ingestion module owns two operations:

- reconcile the next database-derived unit of work;
- read truthful ingestion and freshness status.

The module hides discovery, download, ZIP/XML streaming, validation, projection, replay, cleanup, and provider policy. The USPTO catalog is the true-external adapter.

## Source contracts

- `TRTYRAP` has official frequency `YEARLY`. The baseline is the exact 91-member set covering 1884-04-07 through 2025-12-31 from retained metadata response SHA-256 `48e2760d6c87175969373199aa914d06e3208d6db2345a8f1647edec329ccdd5`.
- `TRTDXFAP` has official frequency `DAILY`. Daily continuation initially starts after 2025-12-31, then requires the day after durable `completeThroughDate` with filename `apcYYMMDD.zip`. Discovery accepts retained overlap and rolled catalogs, succeeds when no newer member exists, and fails on a gap in the forward sequence.
- Coverage dates establish batch membership and the contiguous freshness frontier. They do not bound record transaction dates.
- Filename and physical record index are compact source coordinates, not cross-record precedence.

## Durable state

One `source_artifact` row per product and filename stores catalog identity and coverage, download state/error/response metadata, the retained ZIP pointer and SHA-256, and projection state/error/version/counts. A retained ZIP has `download_state = complete`; `download_state = unavailable` truthfully denotes a live legacy projection whose source ZIP is absent and prevents automatic download or replay. The one `source_lane` row stores global provider status, next eligibility, consecutive failure count, and a safe current error. `data_state` stores only the contiguous complete-through date, last successful update time, and monotonic data version.

The live projection is:

- `mark`
- `mark_class`
- `mark_owner`
- `mark_goods_services`
- `mark_status_event`

Every projected row carries product, filename, SHA-256, and physical record index. There is no source-observation, claim, contributor, publication-candidate, generation, attempt-history, or diagnostic graph.

## Reconciliation and provider policy

The single worker reconciles immediately on startup, then waits a fixed 10 seconds after each reconciliation completes before starting the next. The process-local loop never overlaps or accumulates delayed work; a transaction-scoped advisory lock still serializes artifact lifecycle changes at the database. Each reconciliation performs one database-derived action:

1. remove one unreferenced orphan ZIP;
2. project or replay one retained ZIP;
3. download the next pending artifact;
4. discover the annual baseline or daily continuation;
5. report idle or provider backoff.

A process interruption before ZIP retention makes that artifact's download terminally failed on restart; it is never downloaded again automatically. Any finalized but uncommitted ZIP is removed first as an orphan. A retained artifact with pending, interrupted, failed, or obsolete-version projection is replayed locally from its verified ZIP with no provider call. Projection replay starts by removing only rows still owned by that product and filename inside the new artifact transaction.

All provider access uses `USPTO_API_KEY`. Authentication, authorization, catalog-contract, transport, and non-file-specific HTTP failures use the persisted provider lane with capped exponential backoff and an eight-attempt private fail-closed ceiling. The first file-specific HTTP 429 terminally fails only that artifact, retains safe response metadata, and leaves later artifacts eligible; the same source version is not requested again automatically. The serial flow stays below five files per 10 seconds per IP. An accepted signed redirect is fetched immediately and never receives the API key.

## Streaming projection

Exactly one ZIP is downloaded or projected at a time. The worker hashes and durably retains each download, opens the sole XML entry with `unzipper`, and streams `case-file` events with `xml-flow`. It never buffers an artifact or writes extracted XML.

Every document must use root `trademark-applications-daily`, exactly one `version-no` `2.0`, and exactly one `version-date` `20041108` before records. Action keys group records for source ordering only; they never select, reject, or change a record's product meaning. Every physical record must be well formed and have an eight-digit serial identity. A record is selected only with a non-empty word mark and explicit `primary-code` `025` evidence. Sparse daily records without enough projection data are ignored; a later complete daily record that no longer asserts Class 025 removes the live row.

Selected records project in fixed 100-record batches. Expanded status events use statements of at most 250 rows inside the artifact transaction. Missing, zero, and malformed-width optional dates become null; exactly eight-digit non-calendar dates remain invalid. Nonzero registration numbers normalize to seven digits. Repeated source status events collapse by their exact event fingerprint while distinct transitions remain.

For an upsert, serial number is global identity. A newer source transaction replaces the mark and its child collections; an older, equal, or undated competing record cannot overwrite it. A dated record may supersede stored state whose transaction date is unknown. Replaying one artifact first removes only live rows still owned by that product and filename, then reapplies its bytes. Rows already superseded by another artifact survive replay.

Artifact projection is one database transaction. Success commits all row changes, projection counts/version, freshness, and at most one data-version increment. Parse or validation failure rolls back all row changes and records one clear projection error. Both outcomes retain the referenced compressed ZIP for local replay; cleanup removes only finalized objects with no database reference.

## Query visibility and freshness

All rows in the live mark tables are always queryable. Search, exact lookup, text matching, and reports never join through an availability pointer. No baseline-progress state can return `SERVICE_UNAVAILABLE`; an empty database returns empty search results and missing exact identities return `NOT_FOUND`.

`data_state.version` increments once for each successfully committed artifact that materially changes live rows. Paged callers may pin it and receive `CONFLICT` if live data changes between pages. `completeThroughDate` remains null until the 91 annual members complete, then advances through the contiguous completed daily frontier. `lastSuccessfulUpdateAt` advances on every successful artifact, including a valid zero-selected batch.

Sync status reports baseline progress, pending and failed artifacts, provider state, freshness, and the data version. It describes currentness; it never controls data access.

## Migration and recovery

Landed migration history is immutable. Forward migration preserves live projections, source artifacts, provider state, accounts, Clerk identities, API keys, and roles. It separates download and projection lifecycle truth. Referenced ZIPs remain replayable; absent legacy source bytes become explicitly `unavailable` while their committed projections remain live.

Retained ZIPs are durable source state and are backed up with PostgreSQL plus the deployed Git revision. No compatibility schema, dual write, fallback reader, attempt graph, or generic reprocessing API exists.

## Verification

- Byte-exact annual and daily fixtures carry source and action context.
- Parser tests cover Class 025 selection, sparse daily actions, removal, malformed optional dates, repeated class codes, and bounded status events.
- Real PostgreSQL tests cover partial-data visibility, retained artifact replay, newer-record precedence, data-version conflicts, restart, provider limits, orphan cleanup, and migration truth.
- Production-shaped verification uses an isolated Compose project and retained source bytes. Live production is not a verification target.
