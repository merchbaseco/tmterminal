---
summary: Defines the operator-quality source status page, Latest Processed, Needs Attention, source-file ledger, and per-file Repair behavior.
read_when:
  - changing `/ops/sync`, freshness copy, source-file visibility, issue presentation, or repair controls
  - deciding whether an ingestion condition is normal progress, a file issue, or a system failure
---

# Source Status

Status: Accepted target behavior; current `/ops/sync` remains read-only until
the ingestion migration adds the per-file Repair action.

The source status page explains how current the database is and what needs human
attention. It never controls whether trademark data is searchable.

The page uses customer-quality language even though its controls are
operator-only in v1.

## Summary

The page leads with two things:

- **Latest Processed.** Newest source coverage date whose validated safe records
  have been applied.
- **Needs Attention.** Active system failures, blocked downloads, and
  application issues with the affected file, a plain-language problem, and the
  required action.

Normal pending, downloaded, or applying work is not an issue. There is no
corpus health, complete frontier, queue percentage, annual section, or daily
section.

## Source Files

One ledger keeps a durable row for every discovered source file. It supports:

- All, Needs attention, In progress, and Complete filters;
- filename and coverage;
- download and application state;
- physical, applied, and unresolved record counts;
- projected mark count;
- latest update time;
- plain-language storage state;
- technical source coordinates and current error in expanded details.

A deleted temporary ZIP reads `Cleaned up`, not `Unavailable`. A blocked older
file completely covered by later applied source data reads
`Not downloaded · Covered by newer source data` and is not an active issue.
Bootstrap files intentionally displaced by the selected broad history use the
neutral `Not required · Selected broad source pending` presentation until that
group completes. Only then do they use the covered presentation. They never
masquerade as pending downloads.

Annual and daily are provider metadata. They do not create separate UI,
progress, or health concepts.

## Worker Status

One current worker row records its last heartbeat, current file, and current
system error. A heartbeat older than five minutes appears in Needs Attention.
There is no heartbeat history or global provider retry lane.

## Repair

`Repair` is a per-file operator action.

- If the ZIP remains, Repair replays it with the deployed parser.
- If it was cleaned, the confirmation shows the file's durable request count
  before allowing one new provider request.
- Existing trademark data stays available while corrected records replace it.
- Repair never clears the database, starts a corpus rebuild, or retries every
  file automatically.

Parser version and source coordinates live in technical details; the primary
action remains `Repair`.

## Access

`/ops/sync` requires a Clerk session and the server-enforced operator role.
API keys and ordinary authenticated website users cannot mutate source state.

## Related

- [Ingestion](../internals/ingestion.md)
- [Data model](../reference/data-model.md)
- [Source repair](../operations/source-repair.md)
