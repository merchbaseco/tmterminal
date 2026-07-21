---
summary: Defines the accepted source pipeline for discovery, single-request download, two-pass application, live updates, cleanup, restart, and historical repair.
read_when:
  - changing USPTO discovery, downloads, ZIP storage, XML validation, projection, precedence, cleanup, or worker restart
  - changing source states, parser versions, Class 025 selection, source status, or repair behavior
---

# Ingestion

USPTO files are transport batches into one ever-updating database. Every safe
committed update is immediately searchable. Source progress and failures never
gate reads.

## Ownership

One ingestion module owns:

- daily source discovery;
- durable file download state and provider request accounting;
- temporary ZIP storage;
- complete XML validation and trademark projection;
- live mark and child replacement;
- source cleanup, restart, status, and one-file repair.

The USPTO catalog and artifact store are its only external adapters. The module
exposes narrow reconcile, status, and repository repair operations. Repair is
run by an agent from the repository; it is not a website mutation.

## Discovery And Queue

Discovery runs on worker startup and every 24 hours. It reads supported
trademark-application product metadata and upserts product-plus-filename Source
Artifacts. Discovery is not a file download.

Initial bootstrap marks the broadest available coverage group and narrower files
ending after it as `required`. Earlier overlapping files are `deferred` and
store the selected broad coverage range. They remain visible but do not enter
the queue. They become `covered` only after the selected broad group applies
completely. If that group fails, an operator may promote a deferred file to
`required` as a deliberate fallback repair. After bootstrap, every newly
discovered file is `required`, including later broad reconciliation files.

The worker handles one file end-to-end. It never prefetches a later ZIP. Pending
work sorts by:

1. Processing Disposition is `required` and Download State is `pending`;
2. earliest coverage end date;
3. earliest coverage start date;
4. filename.

Annual and daily frequency labels do not change queueing, parsing, application,
or status behavior. A backlog may delay newer files; correctness matters more
than skipping ahead.

## Download

Before contacting USPTO, one transaction increments the file's request count
and moves Download State from `pending` to `downloading`. The worker then follows
the exact short-lived data redirect immediately and streams the response into a
file reserved by Source Artifact ID while computing size and SHA-256.

The API key is sent only to `api.uspto.gov`, never to the redirected data host.
Signed URLs are never persisted. Product and filename are the durable provider
locator.

After restart:

- complete reserved bytes matching the expected size are hashed and adopted
  without a new provider request;
- absent, partial, or unverifiable bytes make the download `blocked`;
- blocked downloads never retry automatically.

An operator may deliberately spend one more request after seeing the durable
request count. Changed official bytes for the same product and filename require
operator approval and increment that file's content revision.

## Application

One downloaded ZIP is processed in two streaming passes:

1. Validate the complete document and every projected record without database
   writes.
2. Replay the same ZIP and apply usable snapshots in fixed 250-record
   transactions.

The parser does not extract XML to disk or buffer the whole file. The private
batch size changes only from measured production evidence.

Document validation requires the official root, version, version date, and
well-formed transport framing. An invalid document applies nothing. A valid document with
individual unresolved records applies every safe record, records the unresolved
count and one concise error, and retains the ZIP.

Each committed batch:

- updates Trademark Recency for every safe processed serial;
- replaces a tracked mark and all of its child collections from one winning
  snapshot when precedence allows;
- increments Data Version once only when query-visible data changes.

There is no generation, publication, corpus activation, whole-file transaction,
per-field claim graph, or record-error ledger.

## Selection And Recency

V1 fully materializes records with a non-empty word mark and evidence for a
Tracked Class. Class 025 evidence is either:

- explicit `international-code` `025`; or
- `primary-code` `025` when filing date is on or after 1973-09-01.

Earlier primary codes are United States classes. A missing filing date cannot
authorize the primary-code shortcut.

A usable snapshot has a valid source transaction date plus enough identity,
mark, and classification data to replace the mark as a whole. Sparse or undated
records never partially patch live data.

Precedence is exact:

1. Later source transaction date wins.
2. Missing date cannot replace dated state.
3. Equal date and identical snapshot is a no-op.
4. Equal date with differing logical files is an application issue.
5. The same source coordinate may be corrected by a newer parser version.
6. An approved higher content revision of the same file may correct its earlier
   revision at the same date.

Artifact frequency, filename, coverage, download time, and application order are
not tie-breakers.

Once a mark is legitimately established in a Tracked Class, later status changes
keep it present even when abandoned, cancelled, expired, or otherwise inactive.
A later nontracked snapshot advances Trademark Recency but does not ordinarily
delete the mark. Historical repair may remove only a projection proven to have
never had valid tracked-class evidence.

## Completion And Cleanup

Application ends in:

- `complete` when the full document validates and all safe records apply with
  zero unresolved records;
- `needs_attention` when the document is valid but record issues remain or the
  parser cannot interpret it.

A complete file deletes its temporary ZIP. Cleanup failure is logged as an
ordinary worker error; the pointer remains so later cleanup can retry. Cleanup
does not change application completeness or data availability.

A `needs_attention` file retains one ZIP for whole-file replay by a newer parser
version, regardless of unresolved-record count. A parser-version change never
queues retained history automatically; an agent inspects and replays one file.

## Failure And Restart

Source failures are isolated to one file. They appear in Needs Attention while
unrelated files and all data queries continue.

Database, disk, artifact-store, or worker-code failures stop the worker. The
deployment smoke requires at least 20 GiB free in PostgreSQL and artifact
storage. The worker surfaces the original system error; it does not auto-prune,
relabel the file, or continue through fallback machinery.

An interrupted `applying` file replays idempotently from its retained ZIP after
the system fault is fixed. Repeated interruption remains a System Failure; it is
never reclassified as a source or parser issue merely because it happened more
than once. A semantic parser change increments the monotonic parser version.
Refactors and performance changes do not bump it.

## Coverage Resolution

Files with identical exact coverage form a derived coverage group. When every
file in a later group applies completely, it may resolve a blocked older file
whose coverage it replaces. The older row and request count remain, but its
status becomes `Not downloaded · Covered by newer source data` and it leaves
Needs Attention.

Coverage groups are not persisted releases or query gates.

## Historical Repair

Repair is explicit, one file at a time, through the private repository workflow.
An agent inspects durable state before authorizing any new provider request.
Existing data remains searchable and is corrected record by record. A parser
release does not automatically replay all completed history. See
[Source repair](../operations/source-repair.md).

## In-place Migration

The migration preserves existing marks, children, accounts, identities, keys,
roles, and useful source rows. It seeds Trademark Recency from current
provenance, maps successfully applied rows without ZIPs to `downloaded` plus
`complete` and `Cleaned up`, and clears the false `Retained ZIP unavailable`
error.

There is no wipe, shadow database, activation switch, compatibility reader, or
empty-search period. Retained files are repaired first; missing historical files
are reacquired only through explicit one-file operator actions.

## Related

- [Data model](../reference/data-model.md)
- [USPTO source](../reference/uspto-source.md)
- [Source status](../product/source-status.md)
- [Live trademark knowledge decision](../decisions/live-trademark-knowledge.md)
