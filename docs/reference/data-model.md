---
summary: Defines target persistence ownership, source-file lifecycles, trademark recency, winning snapshots, provenance, and exact replacement precedence.
read_when:
  - changing Drizzle schema, source states, mark provenance, parser versioning, or Data Version
  - debugging stale overwrites, replay behavior, source issue status, or pagination conflicts
---

# Data Model

Status: Accepted target contract. Names in the deployed schema may differ until
the in-place ingestion migration lands.

## Ownership

| State | Purpose |
| --- | --- |
| Accounts, Clerk identities, API keys, roles | Durable authentication and authorization. |
| Source Artifact | One product-plus-filename ledger row with coverage, download, application, counts, pointer, provenance, and current error. |
| Worker Status | One current heartbeat, current file, and system error. |
| Trademark Recency | Minimal winning source date, coordinate, and parser version for every processed serial. |
| Mark and children | Current tracked trademark snapshot and its classes, owners, goods/services, and status events. |
| Data Version | One monotonic query-visible version for stable pagination. |

There is no corpus, generation, publication, source lane, retry queue, issue
history, source-version history, per-field claim, contributor, or complete
frontier table.

## Source Artifact

Identity is `(product, filename)`. The row stores:

- coverage start and end, expected bytes, and provider metadata;
- processing disposition `required`, `deferred`, or `covered`, plus the selected
  broad coverage range for deferred or covered rows;
- Download State, request count, content revision, SHA-256, actual bytes, and
  nullable temporary object pointer;
- Application State, parser version, validation and completion times;
- physical, applied, unresolved, and projected-mark counts;
- optional coverage-resolution facts;
- one current error and update timestamp.

Signed redirect URLs are not durable state.

Only `required` plus `pending` rows enter the download queue. Bootstrap stores
overlapping historical files as `deferred` until the selected broad group
applies completely, then marks them `covered`. Later successful broad groups may
also cover blocked older rows. Covered rows remain visible and retain request
history without becoming active issues.

### Download State

| State | Meaning |
| --- | --- |
| `pending` | Discovered and never requested. |
| `downloading` | Request count persisted; bytes may be streaming. |
| `downloaded` | Verified bytes were obtained, even if later cleaned. |
| `blocked` | Bytes were not obtained and no automatic new request is allowed. |

### Application State

| State | Meaning |
| --- | --- |
| `pending` | Downloaded file awaits application. |
| `applying` | Validation or batched live application is active. |
| `complete` | Full file validated and all safe records applied with no unresolved records. |
| `needs_attention` | A deterministic document or record interpretation issue needs repair. |

## Source Coordinate

Winning trademark provenance contains:

```text
product
filename
content revision
SHA-256
physical record index
source transaction date
parser version
snapshot hash
```

The mark owns one winning coordinate. Its classes, owners, goods/services, and
status events are replaced together from that snapshot.

## Replacement Precedence

| Existing vs candidate | Result |
| --- | --- |
| Candidate has later source transaction date | Replace mark snapshot. |
| Candidate lacks date and existing is dated | Ignore candidate for live state. |
| Dates equal and snapshot hashes match | No-op. |
| Dates equal, files differ, snapshots differ | Record an application issue. |
| Exact coordinate, newer parser version | Allow corrected interpretation. |
| Same product/filename, approved higher content revision | Allow corrected official bytes. |

Filename, frequency, coverage, download time, and processing order never decide
which trademark snapshot wins.

## Mark Persistence

Once valid tracked-class evidence establishes a mark, later inactive USPTO
status updates replace its state without deleting it. A later snapshot without
tracked-class evidence updates Trademark Recency only. Historical repair may
remove a mark only after proving its winning projection never had valid tracked
evidence.

## Data Version

Each application transaction that materially changes query-visible mark data
increments Data Version once. Source-only progress and no-op snapshots do not.
The version has no freshness date and is not customer-facing.
