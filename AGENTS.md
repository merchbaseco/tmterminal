# Trademark Turtle Agent Guide

## Working model

- Run `bun run docs:list` at task start and read docs whose `Read when` hints match the work.
- Read `docs/plan.md` before architecture, ingestion, API, client, CLI, website, or deployment work.
- Read `docs/ingestion.md` before USPTO source, parser, canonicalization, provenance, replay, or freshness work.
- Read `docs/cli.md` before changing commands, credentials, output, errors, or pagination.
- Read `docs/website.md` before website, authentication UI, search UI, reports, or visual-system work.
- Prefer the right end state. Do not add legacy aliases, compatibility shims, dual-write paths, or website features outside the v1 contract.
- Keep changes small and reviewable. Preserve unfamiliar work.
- Use Bun and the repository's pinned toolchain.
- Use Conventional Commit messages.
- Do not push unless explicitly asked.

## Product contract

- Trademark Turtle is an authenticated service with a thin search website for print-on-demand sellers.
- The service owns USPTO discovery, downloads, parsing, normalization, persistence, freshness, and search semantics.
- Callers learn the typed Trademark Turtle interface; they do not learn USPTO dataset or parser details.
- Every data procedure requires either a Clerk session or an API key. There are no anonymous data routes in v1.
- Exact serial and registration numbers are identities. Never treat them as fuzzy search terms.
- Apply filtering and sorting on the server before pagination and count.
- Corpus state is database-backed. Worker completion must be observable across processes.
- USPTO records are ordered partial observations. Never merge whole marks by `status_date` or infer deletion from source absence.
- Public corpus-through date is the contiguous complete frontier, not the newest downloaded or published artifact.

## Code shape

- Target a Bun workspace with `apps/server`, `apps/web`, `packages/http-client`, and `packages/cli`.
- Keep the server and website apps private. Publish only the HTTP client and CLI.
- Keep SQL in query/repository modules; route modules call domain services.
- Derive client input/output types from the server router. Do not duplicate DTOs.
- Keep files cohesive, use kebab-case names, avoid barrel exports, and export only imported symbols.
- Test behavior through module interfaces using real PostgreSQL where persistence semantics matter.

## Verification

- Parser changes require byte-exact real XML fixtures with source/action context.
- Ingestion changes require replay, out-of-order, reissue, provenance, and atomic-publication coverage.
- Search changes require filter, sort, count, pagination, and index-use coverage.
- Client and CLI changes require contract generation/build plus JSON-envelope tests.
- Website changes require focused automated checks plus the `app-feature-verification` happy and adjacent paths.
- Deployment changes require local Compose health verification before release.

## Agent skills

### Issue tracker

Issues are tracked in Linear under the Products (`PRD`) team and routed with the `Trademark Turtle` label. See `docs/agents/issue-tracker.md`.

### Triage labels

The Linear Products team uses the canonical triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
