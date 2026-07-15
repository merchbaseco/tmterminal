---
summary: Records the decision to project USPTO records as presence-aware ordered claims over immutable source observations.
read_when:
  - changing parser presence semantics, source precedence, canonical projection, replay, or provenance
  - deciding how annual and daily USPTO records replace or preserve canonical field groups
---

# Model USPTO records as ordered claims

## Context

USPTO `case-file` records are partial observations. Retained annual `TX` records may assert lifecycle facts while omitting mark text, filing facts, owners, classifications, and goods/services. Retained daily records also demonstrate group changes without a changed `status_date`.

Official `TRTYRAP` metadata identifies one generation as 1884-04-07 through 2025-12-31. Its retained `-05` part was created on 2026-04-03 and contains 1,107 records with 2026 transaction dates through 2026-04-02. The metadata range therefore identifies generation membership; it is not the maximum record transaction date or a canonical cutoff. USPTO metadata does not declare semantic precedence between annual and daily products or between annual parts.

MerchBase supplies migration context, not source authority. Its current importer chooses a whole row by strictly newer `status_date`; equal dates preserve incidental file-processing order, and sparse annual records are skipped. Trademark Turtle does not inherit that heuristic or use MerchBase canonical rows as bootstrap evidence. MerchBase-owned preferences remain a separate migration concern.

## Decision

Trademark Turtle stores immutable artifact versions and lossless source observations, then materializes each canonical group by folding presence-aware typed claims over a versioned source-authority partial order.

An authority policy adds an order edge only at the scope proved. Official source documentation may establish a reusable product, action-profile, or group rule. An exact retained fixture sequence establishes only its observed transition unless further evidence proves generalization. A source transaction date may participate in such a proved edge. `status_date`, metadata dates, release times, filenames, suffixes, API response position, physical record order, ingestion order, and database identity do not create whole-record or cross-product authority.

The v1 authority policy pins the complete generation from 1884-04-07 through 2025-12-31 enumerated by retained metadata response SHA-256 `48e2760d6c87175969373199aa914d06e3208d6db2345a8f1647edec329ccdd5`. Annual parts are an unordered set of generation members. Catalog order never selects a generation; older generations are not co-folded, and a later generation is ineligible until an explicit policy revision. Eligibility and generation completeness belong to PRD-63, not the PRD-59 canonicalizer.

Annual and daily observations have no general precedence edge. For every serial number and claim path that spans unordered observations, resolution requires semantic confluence: every order permitted by the authority policy must produce the same normalized value. Unmentioned claims do not mutate a group; additive assertions commute with fact-level provenance. Unordered set, clear, or replace claims that assert the same semantic value resolve normally. Different semantic values remain an authority conflict unless the policy orders them.

Canonical provenance is a contributor set. For each claim path it contains every observation carrying a non-dominated effective claim that establishes the resolved value or additive fact; group provenance is the union of those sets. Identical unordered claims therefore retain every supporting observation rather than selecting an authority winner. Contributor references have a stable serialization order by product, artifact-version SHA-256, and physical record index; that order is storage representation only.

Unresolved output has two kinds. `authority-conflict` returns a serial, group, claim path, observations, policy version, and competing known values. `unsupported-semantics` returns the same source coordinates plus a presence or operation whose meaning the profile does not prove. Both make the publication candidate ineligible; neither invents a tie-break or operation. PRD-63 owns diagnostic persistence and corpus publication mechanics.

## Consequences

- Canonical provenance is group-specific, supports multiple contributors, and is replayable from retained bytes.
- Full annual records and status-only annual `TX` records can compose without erasing unmentioned groups.
- PRD-59 can fold caller-supplied eligible observations, fixture-proven same-product transitions, confluence checks, contributor sets, and both unresolved output kinds before cross-product precedence is known. Source-set eligibility and corpus publication remain outside that canonicalizer.
- Complete mixed-product publication waits for zero unresolved conflicts. New official evidence can add a narrow policy edge without rewriting source observations.
- Generic whole-row replacement, a `productToDate` cutoff, pre-cutoff gap-fill authority, and MerchBase parity as authority are rejected.

## Tracer proof

The PRD-60 tracer uses committed fixture `annual-2025-full-tx` for serial `60146682`, registration `0146682`, and word mark `MACHINE-PISTOL`. Its exact record SHA-256 is `4bea4c8e9493c6945b1734a6f5eb3075256519fd5e463e704545d8867356d636`; its artifact belongs to the officially enumerated 2025 annual generation.

For the fixture-scoped eligible input used by the tracer, each present claim path has one effective claim. The partial order therefore has one semantic result for mark presentation, application facts, registration facts, lifecycle, classifications, owners, and goods/services, and every group has the fixture observation as its sole contributor. The confluence gate resolves the mark. Complete-generation selection and atomic corpus publication are PRD-63 concerns, not an additional PRD-60 blocker.

The current PRD-58 parser records the fixture's present owners group without an operation. PRD-59 must promote a present, non-empty owners group to **Replace** in the XML v2.0 profile before the tracer materialization passes. This is source-backed rather than inferred: the official v2.0 documentation says `case-file-owners` contains all owner records. Absence remains unmentioned; present-empty remains unresolved. The tracer has one owner record, so its source owner name is unambiguous, but the collection contract does not establish a reusable current-legal-owner selection rule.
