---
summary: Records that perpetual live projection supersedes ordered claims and query-isolated builds.
read_when:
  - changing live projection, source coordinates, artifact replay, daily continuation, or provenance
  - reconsidering source observations, ordered claims, contributors, publication candidates, or hidden builds
---

# Project USPTO batches directly into live trademark data

Status: accepted; supersedes this ADR's original ordered-claims decision and the later query-isolated annual-build decision.

## Context

Annual `TRTYRAP` members and daily `TRTDXFAP` files are transport batches. Treating them as immutable observations, ordered claims, publication candidates, or complete query-visible builds adds lineage and visibility machinery without improving the product result.

MerchBase proves the useful shape: process one artifact, stream `case-file` records, delete rows still owned by a replayed source file, upsert newer serial identities, and clean raw files immediately. Trademark Turtle adds only the server concerns that earn their keep: authenticated delivery, richer child projections, search, provider limits, durable artifact state, data-version continuity, and freshness.

## Decision

PostgreSQL's mark tables are perpetual live product state. Each successfully parsed artifact updates those tables in one transaction. Search, exact lookup, text matching, and reports always use every currently stored row; baseline or daily progress never gates reads.

Serial number is global identity. A selected record with a newer source transaction replaces the mark and its class, owner, goods/services, and status-event collections. A later complete daily record that no longer asserts Class 025 removes the live mark. Compact product, filename, SHA-256, and physical record index coordinates remain on projected rows.

Artifact replay is scoped to product and filename: delete live rows still owned by that artifact, then reapply its bytes in the same transaction. Rows already superseded by another artifact survive replay. `source_artifact` owns lifecycle and counts; `source_lane` owns provider backoff; `data_state` owns only complete-through date, last successful update, and a monotonic version.

The annual baseline is the exact 91 official files through 2025-12-31. It is followed by calendar-contiguous daily files. Annual and daily records use one parser and projection path, one retained ZIP at a time, fixed projection batches, bounded expanded status-event inserts, and immediate ZIP cleanup.

## Consequences

- Partial and empty databases are valid query states.
- No corpus generation, active/building pointer, activation event, query join, or availability error exists.
- Material artifact commits increment the data version once; pagination may detect a changed live dataset.
- Sync status reports baseline progress, daily freshness, pending/failed artifacts, and provider health without controlling data access.
- There is no source-observation, claim, contributor, publication-candidate, generalized version-selection, attempt-history, diagnostics, compatibility, or fallback graph.
