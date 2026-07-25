---
summary: Records the decision to keep one perpetual live trademark database and make ingestion progress independent from query availability.
read_when:
  - reconsidering corpus generations, publication gates, complete frontiers, hidden builds, or query availability errors
  - changing source application, mark replacement, replay, freshness, or Data Version
---

# Keep Perpetual Live Trademark Knowledge

Status: Accepted

Date: 2026-07-20

## Context

USPTO annual and daily files are packaging for a very large, continuously
updated source. Treating them as query-visible corpora, releases, generations,
or publication candidates made ordinary search depend on ingestion completion
and created state that did not improve the product result.

The useful model is simpler: process source files into a database, then query
whatever the database currently knows. Progress describes freshness and known
problems, not availability.

## Decision

PostgreSQL is perpetual Live Trademark Knowledge. Every safe application batch
updates it immediately. Search, exact lookup, listing, text matching, and
screening read the live tables without joining source lifecycle or an
activation pointer.

Source files retain durable acquisition and application state for operations,
provenance, quota safety, and repair. Annual and daily labels do not create
different pipelines. Source transaction date controls record recency; Data
Version provides pagination continuity.

## Consequences

- Empty and partially populated databases remain valid query states.
- Ingestion never returns “corpus unavailable.”
- Latest Processed and Needs Attention explain currentness without hiding rows.
- No corpus, generation, publication, activation, or complete-frontier state is
  allowed.
- Application uses bounded transactions rather than one whole-source or
  whole-dataset transaction.
- Existing data remains searchable during repair and schema cutover.
- Durable source rows remain necessary even though raw ZIPs are temporary.
