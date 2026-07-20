---
summary: Defines how agents inspect and repair one source file without automatic redownloads, bulk replay, or query downtime.
read_when:
  - repairing a blocked download, parser issue, unresolved record, interrupted application, or official file reissue
  - changing repository repair controls, request confirmation, parser replay, or source cleanup
---

# Source Repair

Status: Accepted target workflow; it is not executable until the source-state
migration and private repository repair operation land.

Repair one Source Artifact at a time with the private repository operation. An
agent runs it from a production checkout after inspecting the file. `/status`
remains read-only. There is no website mutation, public API, published `tt`
command, bulk repair, or automatic historical replay.

The operation must require one exact Source Artifact identity. It first reports
the file's current download, storage, and application facts without changing
state. Any action that would contact USPTO requires a separate explicit
reacquisition flag; a parse-only replay must not accept that flag.

## Before Repair

Inspect the row's:

- product, filename, and coverage;
- Download State and durable request count;
- Application State and parser version;
- SHA-256, actual bytes, and temporary storage state;
- applied and unresolved counts;
- current error and worker status.

Before authorizing reacquisition, read the durable Download Request Count and
the [USPTO access limits](../reference/uspto-source.md#access-and-limits). Treat
ZIP inputs conservatively: no more than 20 requests for the same file per year
per API key, no more than five files per 10 seconds from one IP, and no automatic
repeat after a failed request. The operation persists the incremented request
count before contacting USPTO.

Confirm that the failure belongs to the file. Database, disk, artifact-store, or
worker-code errors are system failures; fix the system before touching source
state.

## Retained ZIP

If verified bytes remain, repair queues the same file for the deployed parser.
It does not call USPTO. Existing mark data stays searchable while safe corrected
records replace it in batches.

Use a newer Parser Version for changed source semantics. A refactor or
performance-only release keeps the version unchanged.

## Cleaned Or Blocked ZIP

If bytes are absent, the agent reports how many provider requests have already
been spent for that exact file. Explicit reacquisition creates exactly one new
Download Request. No automated loop or provider-lane retry follows a failure.

For an official reissue under the same product and filename, verify the catalog
change, approve it explicitly, and increment the content revision. Winning mark
provenance records the new revision and SHA-256.

## Completion

A successful repair:

- leaves newer source transactions authoritative;
- updates only records whose precedence permits replacement;
- clears the file's active issue;
- deletes the temporary ZIP when no unresolved records remain;
- never changes whether unrelated trademark data can be queried.

Cleanup failure is a worker log and later cleanup retry, not a new data-health
state.

## Historical Correction

When fixing a known parser defect across history:

1. land and deploy the corrected semantics;
2. bump Parser Version only if interpretation changed;
3. repair retained affected files first;
4. inventory request counts before reacquiring cleaned files;
5. repair missing files individually, watching provider quota and disk;
6. verify representative marks and source rows after each file.

Do not clear the mark tables before repair. Safe old knowledge remains available
until each corrected snapshot replaces it.
