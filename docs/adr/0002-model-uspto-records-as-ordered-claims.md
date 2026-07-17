---
summary: Records that direct annual corpus generations supersede the ordered-claims architecture for v1.
read_when:
  - changing annual generation isolation, direct projection, source coordinates, replay, or provenance
  - reconsidering source observations, ordered claims, contributors, or publication candidates
---

# Use direct annual corpus generations for v1

## Status

Supersedes the ordered-claims decision previously recorded in this ADR.

## Context

The first corpus is the exact 91-member `TRTYRAP` annual snapshot through 2025-12-31. Its members are snapshot partitions. Production has no canonical marks, and all existing ingestion/catalog state is rebuildable.

The prior design retained immutable source observations, presence-aware claims, contributor graphs, publication candidates, parent fingerprints, diagnostics, parser generations, version selections, attempts, alerts, and a one-shot cutover framework. For the annual baseline, that machinery repeatedly reconstructed the identity projection already present in each selected snapshot record. It also created parser and operational failure modes unrelated to the customer contract.

MerchBase proves the useful implementation shape: one artifact, `unzipper`, `xml-flow` case-file events, direct projection, fixed batches, and immediate cleanup. Trademark Turtle still needs generation isolation, authenticated delivery, server-side search, corpus versioning, freshness, and atomic visibility.

## Decision

Trademark Turtle v1 builds a generation-scoped corpus directly from the pinned annual files. Each valid record with a non-empty word mark and explicit Class 025 evidence projects into `mark`, class, owner, goods/services, and status-event rows with compact product/filename/SHA/physical-index coordinates.

One deep ingestion module reconciles the next database-derived action and reads truthful status. One compact source-artifact row owns coverage, state, counts, current error, and transient ZIP identity. One source lane owns provider backoff/stop state.

The building generation remains invisible. Only exact 91/91 completion atomically advances `corpus_state`, both 2025-12-31 frontiers, `corpusVersion`, and the durable corpus event.

Daily `TRTDXFAP` processing is deferred. This ADR establishes no annual-versus-daily precedence and no daily update semantics.

## Consequences

- Source observations, claims, contributors, publication candidates, reprocessing versions, selection frameworks, source history graphs, and embedded cutover DDL leave the runtime.
- Raw ZIPs are transient and deleted after success or terminal failure.
- Restart derives work from generation/artifact rows; completed members do not replay.
- Customer search and exact lookup select only the active generation and retain corpus-version conflicts.
- The forward migration discards rebuildable ingestion/canonical state while preserving auth/role and provider-lane data.
- Later daily support must define chronological direct group updates from authentic daily shapes. It must not revive the superseded v1 architecture by default.
