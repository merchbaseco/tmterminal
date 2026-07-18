# Trademark Turtle Agent Guide

## Working model

- Run `bun run docs:list` at task start and read docs whose `Read when` hints match the work.
- Read `docs/plan.md` before architecture, ingestion, API, client, CLI, website, or deployment work.
- Read `docs/ingestion.md` before USPTO source, parser, projection, provenance, replay, or freshness work.
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
- Source-artifact and data state are database-backed. Worker completion must be observable across processes.
- USPTO artifacts update perpetual live Class 025 tables transactionally; ingestion progress never gates reads.
- The exact pinned annual baseline is followed by calendar-contiguous daily updates.
- Public data-through date is the contiguous complete frontier, not the newest downloaded artifact.

## Code shape

- Target a Bun workspace with `apps/server`, `apps/web`, `packages/http-client`, and `packages/cli`.
- Keep the server and website apps private. Publish only the HTTP client and CLI.
- Keep SQL in query/repository modules; route modules call domain services.
- Derive client input/output types from the server router. Do not duplicate DTOs.
- Keep files cohesive, use kebab-case names, avoid barrel exports, and export only imported symbols.
- Test behavior through module interfaces using real PostgreSQL where persistence semantics matter.

## Code quality

- Keep TypeScript strictness and the repo-standard Ultracite/Biome configuration intact. Use
  `bun run lint` for the lint baseline and `bun run lint:fix` only on explicit quality-only paths.
- Build contracts and types before implementation details. Prefer inference from tRPC, Zod, and
  Drizzle; validate external input at boundaries; model states with narrow unions and exhaustive
  checks.
- Keep failures explicit and contextual. Do not swallow errors or add broad catches, fallback
  paths, speculative retries, compatibility branches, or defensive machinery outside the current
  contract.
- Keep hand-written production modules cohesive; target under roughly 300 lines and split when
  responsibilities diverge. Do not mechanically split generated code, COSS primitives, fixtures,
  or cohesive tests to satisfy a number.
- Keep the main export and core flow near the top and local helpers near the bottom. Prefer concrete
  product nouns over vague names such as `manager`, `helper`, or `data`.
- Keep transport routes thin: authenticate, validate, call domain logic, and return a narrow result.
  Keep SQL in query/repository modules and map database or external payloads explicitly at
  boundaries.
- Use the server and TanStack Query cache as data sources of truth. Derive React state during render;
  reserve effects for external synchronization; make cache, freshness, invalidation, and navigation
  persistence intentional.
- Prefer stock COSS UI primitives and existing dependencies. Do not customize or lint vendored COSS
  component internals. Add a dependency only for a current capability and pin it exactly.
- Treat `apps/server/src/db/schema.ts` as schema source of truth. Generate migrations with
  `bun run db:generate`; never hand-edit generated snapshots or rewrite, rename, or renumber landed
  migrations. Inspect generated diffs and verify upgrade/idempotency.
- Do not hand-edit generated output or byte-exact fixtures. Keep generated declarations, build
  output, Drizzle metadata, migration SQL, COSS internals, and retained fixture payloads narrowly
  excluded from formatting and linting.
- Test behavior through public or module interfaces. Choose the smallest lane that proves the
  change, mock only true external boundaries, use real PostgreSQL for persistence semantics, and
  avoid tests whose primary assertion is that a spy was called.
- Ordered provider, transaction, and ingestion loops stay sequential when the contract requires it;
  do not parallelize them merely to satisfy a lint rule.
- Operational failures must identify the operation and relevant artifact. Avoid
  heartbeat, retry, and per-row log noise.

## PRD closeout

Before any PRD commit, PR, merge, or closeout:

1. Inspect the whole diff against its current `origin/main` baseline.
2. Perform a simplification audit and remove unnecessary abstractions, fallback/retry/error
   branches, compatibility paths, duplicate state, and code outside the narrow contract.
3. Report what was removed and justify every remaining nontrivial branch or state surface.
4. Obtain orchestrator approval, then run an independent review.
5. Run lint for every touched authored path, typecheck, focused tests, build, and every applicable
   domain-specific verification lane.
6. Commit and ship only after review findings are resolved; close Linear and archive the Codex task
   only after deployment acceptance.

## Verification

- Parser changes require byte-exact real XML fixtures with source/action context.
- Ingestion changes require restart, idempotency, cleanup, source-coordinate, artifact-replay, live-visibility, and transaction coverage.
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
