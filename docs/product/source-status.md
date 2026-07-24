---
summary: Defines the public Status page, Latest Processed, and operator-only issues and source ledger.
read_when:
  - changing `/status`, freshness copy, source-file visibility, issue presentation, or repair controls
  - deciding whether an ingestion condition is normal progress, a file issue, or a system failure
---

# Status

Status: Accepted target behavior.

The Status page publicly explains how current the database is. Operator-only
sections explain what needs human attention. Neither controls whether trademark
data is searchable.

The page uses customer-quality language even though its controls are
operator-only in v1.

## Summary

The page leads with:

- **Trademark activity.** A dated 30-day chart shows new applications by filing
  date and application updates by each current mark's latest USPTO transaction
  date. The window ends on Latest Processed rather than adding empty future
  dates. A later update moves a mark into its newer date bucket; this is a
  current catalog activity view, not an append-only event ledger. The chart
  replaces a display masthead and begins at the shared page-start position. Its
  header metrics align to the site shell, while the borderless plot runs across
  the viewport without an internal grid. Hovering coordinates both line
  highlights, the themed value panel, crosshair, and animated date ticker. The
  accessible page heading remains `Status`.
- **Catalog snapshot.** Total Class 025 trademarks, new applications in the
  30-day window, and application updates in the same window appear as compact
  metrics above the chart. Total includes live and inactive records and shows
  the year of the earliest non-null filing date. A compact green `Live` signal
  sits at the far right of the metric row.
- **Needs Attention.** Active system failures, blocked downloads, and
  application issues with the affected file, a plain-language problem, and the
  required action. A recognized USPTO file cooldown includes its provider
  request count and estimated retry time; unknown 429 shapes use generic copy.

Normal pending, downloaded, or applying work is not an issue. There is no
corpus health, complete frontier, queue percentage, annual section, or daily
section. Processing throughput and source-file issues stay separate; neither
implies that the rest of the database is unavailable.

The latest processed date, trademark activity, catalog snapshot, and quiet
current work are public. They contain no credentials, source errors, or repair
details. The page does not render Latest Processed as a standalone summary row.

## Operator Details

Needs Attention and Source Files render only after the server confirms the
Clerk account has the operator role. They share one source-ledger surface.
Accurate All and Errors counts form the ledger filter; active issues
expand inline above the file rows. They are never included in the anonymous
status response.

### Source Files

One semantic table keeps a durable row for every discovered source file. It supports:

- All and Errors filters;
- filename and coverage;
- download and application state;
- physical, applied, and unresolved record counts;
- projected mark count;
- latest update time;
- plain-language storage state;
- technical source coordinates and current error in expanded details.

The ledger loads its server-paged rows through document infinite scroll. It
never introduces a nested viewport or replaces already loaded rows.

A deleted temporary ZIP reads `Cleaned up`, not `Unavailable`. A blocked older
file completely covered by later applied source data reads
`Not downloaded · Covered by newer source data` and is not an active issue.
Bootstrap files intentionally displaced by the selected broad history use the
neutral `Not required · Selected broad source pending` presentation until that
group completes. Only then do they use the covered presentation. They never
masquerade as pending downloads.

Annual and daily are provider metadata. They do not create separate UI,
progress, or health concepts.

### Worker Status

One current worker row records its last heartbeat, current file, and current
system error. The worker pulses that heartbeat during long file operations. A
heartbeat older than five minutes—or no heartbeat five minutes after the row
was created—appears in Needs Attention. There is no heartbeat history or global
provider retry lane.

### Repair

The website does not mutate source state. An agent repairs one file through the
private repository workflow after inspecting its durable request count and
storage state. Existing trademark data stays available while corrected records
replace it. See [Source repair](../operations/source-repair.md).

Parser version and source coordinates remain operator-only technical details;
the page offers no source-state action.

## Access

`/status` and its aggregate status response are public. Needs Attention and
Source Files require a Clerk session plus the server-enforced operator role. API
keys and ordinary website users cannot read diagnostics. No website route
mutates source state.

## Related

- [Ingestion](../internals/ingestion.md)
- [Data model](../reference/data-model.md)
- [Source repair](../operations/source-repair.md)
