---
summary: Defines direct annual corpus generations, transient artifact handling, atomic activation, and corpus freshness.
read_when:
  - changing USPTO discovery, downloads, parsing, projection, publication, or freshness
  - changing corpus generation isolation, source coordinates, replay, or status derivation
---

# USPTO ingestion

Trademark Turtle builds one generation-scoped Class 025 corpus directly from the pinned USPTO annual archive. Callers see only the active generation. Source mechanics stay behind one ingestion module interface:

- reconcile the next database-derived unit of work;
- read truthful build and corpus status.

The module hides discovery, download, ZIP/XML streaming, validation, batching, projection, cleanup, and activation. PostgreSQL is durable state. The USPTO client is the true-external adapter.

## Annual source contract

- `TRTYRAP` is the only v1 worker source. Its official ODP product frequency is `YEARLY`.
- The baseline is the exact 91-member generation covering 1884-04-07 through 2025-12-31 from retained metadata response SHA-256 `48e2760d6c87175969373199aa914d06e3208d6db2345a8f1647edec329ccdd5`.
- Coverage dates prove generation membership and the public frontier. They do not bound record transaction dates.
- Parts form snapshot partitions. Filename suffix and physical order are source coordinates, not cross-record precedence.
- `TRTDXFAP` daily files are neither downloaded nor parsed by this pipeline. Daily update semantics require a later product decision.

## Durable state

One `corpus_generation` row owns a build. One `source_artifact` row per generation member stores product, filename, downloaded SHA-256, coverage, state, byte/record/mark counts, current error, and a transient object pointer. The one `source_lane` row stores only provider status, next eligibility, failure count, and a safe current error.

Projected tables are generation-scoped:

- `mark`
- `mark_class`
- `mark_owner`
- `mark_goods_services`
- `mark_status_event`

Every projected row carries product, filename, SHA-256, and physical record index. There is no source-observation, claim, contributor, publication-candidate, parser-generation, version-selection, attempt-history, or diagnostic graph.

## Reconciliation

One pg-boss queue wakes reconciliation on startup and a bounded schedule. A transaction-scoped advisory lock reserves build transitions and serializes activation. Each delivery performs one database-derived action:

1. clean one unreferenced or terminal raw ZIP;
2. activate an exact complete generation;
3. resume/project a downloaded member;
4. discover the pinned generation;
5. download the next pending member;
6. report idle or provider backoff/stop.

A process interruption before ZIP retention makes that artifact terminally failed on restart; it is never downloaded again. Any finalized but uncommitted ZIP is removed first as an orphan. One failed member blocks every later download in that building generation because 91/91 activation is no longer reachable. A completed artifact is never projected again. A projecting artifact resumes from its retained ZIP; its prior transaction has rolled back, so projection restarts cleanly for that source filename.

All provider access uses `USPTO_API_KEY`. Authentication, authorization, contract, and permanent HTTP failures stop the lane. Timeouts, throttling, integrity failures, and server errors use persisted capped exponential backoff with jitter. Eight consecutive attempts is the private fail-closed ceiling; it cannot be raised by configuration, survives restarts, and stops before the provider's 20-download annual same-file limit. The fixed 10-second scheduler and serial artifact flow stay below the provider's five-files-per-10-seconds IP limit. No job-owned workflow chain or second retry loop exists.

## Streaming projection

Exactly one ZIP is retained at a time. The worker hashes and writes the download once, opens the sole XML entry with `unzipper`, and streams `case-file` events with `xml-flow`. It never buffers an artifact or writes extracted XML.

Every XML document must use the `trademark-applications-daily` root and declare exactly one `version-no` equal to `2.0` and one `version-date` equal to `20041108` before records. Every physical record must be well-formed and have an eight-digit serial identity. The parser counts and validates all records, including unselected records. A record is selected only when it has a non-empty word mark and explicit `primary-code` `025` evidence.

Selected records project directly in fixed 100-mark batches. Missing, zero, and malformed-width optional dates become null; exactly eight-digit non-calendar dates remain invalid. Nonzero registration numbers normalize to seven digits. Status, normalization, mark-type, and Class 025 search policies remain server-owned and fixture-backed.

The authentic 10,948,448-byte part-49 record is valid but not selected because it has no Class 025 assertion. Memory is bounded by the current `xml-flow` record, one fixed projection batch, ZIP stream buffers, and database-client buffers.

Artifact projection is one database transaction. Success commits all rows and terminal counts, then removes the ZIP immediately. Parse/validation failure rolls back all rows, stores one clear artifact error, and removes the ZIP immediately. A failed unlink remains a cleanup target and blocks later work.

## Atomic visibility and freshness

A building generation is invisible. Customer reads join `mark` rows through `corpus_state.current_generation_id`; exact lookup, Multi search, filtering, sorting, count, and pagination all use that same pointer.

Activation requires exactly 91 total artifacts, all 91 complete, and a nonzero Class 025 corpus. One transaction:

1. takes the corpus/build advisory lock;
2. marks the generation active;
3. points `corpus_state` at it;
4. sets `publishedThroughDate` and `completeThroughDate` to 2025-12-31;
5. increments `corpusVersion` once;
6. inserts one durable corpus event and sends a PostgreSQL wake-up notification.

At 90/91, after any failure, or after process restart, the pointer is unchanged. Repeating activation is a no-op. Continuation queries retain corpus-version conflict behavior.

## Migration and recovery

Landed migration history is immutable. The forward cutover migrations run in the migrator's single transaction: first discard rebuildable legacy ingestion/canonical tables, then create the direct-generation schema. Account, Clerk identity, API key, role, and provider-lane rows survive.

Raw ZIPs are not backup state. Operational rollback uses the normal PostgreSQL backup plus a known Git revision; no compatibility schema, dual write, legacy reader, fallback pipeline, or embedded rollback path exists.

## Verification

- Byte-exact annual fixtures prove selected Class 025 and unselected part-49 records.
- Module tests cover exact discovery, fixed batches, cleanup, terminal error, restart, and idempotency.
- Real PostgreSQL tests cover auth-preserving migration, generation isolation, 90/91 invisibility, exact 91/91 activation, corpus events, exact lookup, Multi search, and corpus-version conflicts.
- Production-shaped verification uses an isolated Compose project. The live production worker remains stopped until authorized deployment.
